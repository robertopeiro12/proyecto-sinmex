import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as cxc from "@/lib/cuentas-por-cobrar";
import type { CuentasPorCobrar } from "@/lib/cuentas-por-cobrar";
import * as excel from "@/lib/excel/exportar";
import { PantallaCuentasPorCobrar } from "./pantalla-cuentas-por-cobrar";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/cuentas-por-cobrar", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cuentas-por-cobrar")>();
  return { ...real, obtenerCuentasPorCobrar: vi.fn() };
});
vi.mock("@/lib/excel/exportar", () => ({ exportarExcel: vi.fn() }));

const obtener = vi.mocked(cxc.obtenerCuentasPorCobrar);
const exportarExcel = vi.mocked(excel.exportarExcel);

const DATOS: CuentasPorCobrar = {
  hoy: "2026-10-14",
  totalCentavos: 37700,
  vencidoCentavos: 14950,
  notas: 3,
  clientes: [
    {
      clienteId: "c1", cliente: "Cobach XXI", sucursalCodigo: "TJ", clienteDadoDeBaja: false, saldoCentavos: 29900, vencidoCentavos: 14950,
      notas: [
        { id: "n1", fecha: "2026-09-13", folio: "TJ260913AP05", numNota: "2346", montoCentavos: 14950, abonadoCentavos: 0, saldoCentavos: 14950, status: "pendiente", vence: "2026-09-28", diasAtraso: 16 },
        { id: "n2", fecha: "2026-10-10", folio: "TJ261010AP02", numNota: null, montoCentavos: 20000, abonadoCentavos: 5050, saldoCentavos: 14950, status: "abonado", vence: null, diasAtraso: 0 },
      ],
    },
    {
      clienteId: "c2", cliente: "El Moreno", sucursalCodigo: "MX", clienteDadoDeBaja: false, saldoCentavos: 7800, vencidoCentavos: 0,
      notas: [
        { id: "n3", fecha: "2026-10-01", folio: "MX261001JP01", numNota: null, montoCentavos: 7800, abonadoCentavos: 0, saldoCentavos: 7800, status: "pendiente", vence: "2026-10-31", diasAtraso: 0 },
      ],
    },
  ],
};

function mockAuth(permisos: string[], codigoSucursal: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1", login: "ana", nombre: "Ana", perfil: "Administrador General",
      sucursal: codigoSucursal ? { id: "s", codigo: codigoSucursal, nombre: codigoSucursal } : null,
      permisos,
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}

describe("PantallaCuentasPorCobrar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtener.mockResolvedValue(DATOS);
    exportarExcel.mockResolvedValue(undefined);
  });

  it("mientras carga la sesión dice Cargando…, no \"No tienes permiso\"", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin cuentas_cobrar.ver lo dice y no pide nada", () => {
    mockAuth([]);
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver cuentas por cobrar")).toBeInTheDocument();
    expect(obtener).not.toHaveBeenCalled();
  });

  it("pide al abrir y muestra totales y una fila por cliente", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    render(<PantallaCuentasPorCobrar sucursal="TJ" />);
    expect(obtener).toHaveBeenCalledWith({ sucursal: "TJ", soloVencidas: false });
    expect(await screen.findByText("$377.00")).toBeInTheDocument();
    expect(screen.getByText("$149.50", { selector: "[data-total='vencido']" })).toBeInTheDocument();
    expect(screen.getByText("3 notas de 2 clientes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cobach XXI/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("TJ260913AP05")).not.toBeInTheDocument();
  });

  it("abre y cierra las notas de un cliente", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    const fila = await screen.findByRole("button", { name: /Cobach XXI/ });
    await u.click(fila);
    expect(fila).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("TJ260913AP05")).toBeInTheDocument();
    expect(screen.getByText("28/09/2026 · 16 días")).toBeInTheDocument();
    expect(screen.getByText("Sin plazo")).toBeInTheDocument();
    await u.click(fila);
    expect(screen.queryByText("TJ260913AP05")).not.toBeInTheDocument();
  });

  it("con cobranza.registrar, Cobrar enlaza a Cobranza con cliente, nota y sucursal", async () => {
    mockAuth(["cuentas_cobrar.ver", "cobranza.registrar"]);
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal="TJ" />);
    await u.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(screen.getByRole("link", { name: "Cobrar TJ260913AP05" })).toHaveAttribute(
      "href",
      "/operacion/cobranza?cliente=c1&nota=n1&sucursal=TJ",
    );
  });

  it("sin cobranza.registrar no hay botón Cobrar", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    await u.click(await screen.findByRole("button", { name: /Cobach XXI/ }));
    expect(screen.queryByRole("link", { name: /Cobrar/ })).not.toBeInTheDocument();
  });

  it("Solo vencidas vuelve a pedir; una respuesta vieja no pisa la nueva (Review Focus 4)", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    let soltarVieja: (d: CuentasPorCobrar) => void = () => {};
    obtener
      .mockImplementationOnce(() => new Promise((r) => { soltarVieja = r; }))
      .mockResolvedValueOnce({ ...DATOS, totalCentavos: 14950, notas: 1, clientes: [{ ...DATOS.clientes[0], saldoCentavos: 14950, notas: [DATOS.clientes[0].notas[0]] }] });
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    await u.click(screen.getByRole("checkbox", { name: "Solo vencidas" }));
    expect(obtener).toHaveBeenLastCalledWith({ sucursal: null, soloVencidas: true });
    expect(await screen.findByText("1 nota de 1 cliente")).toBeInTheDocument();
    await act(async () => {
      soltarVieja(DATOS);
    });
    expect(screen.getByText("1 nota de 1 cliente")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /El Moreno/ })).toBeNull();
    expect(screen.queryByText("3 notas de 2 clientes")).toBeNull();
  });

  it("al volver a pedir muestra Actualizando… y atenúa lo viejo; al llegar, desaparece", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    let soltar: (d: CuentasPorCobrar) => void = () => {};
    obtener
      .mockResolvedValueOnce(DATOS)
      .mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    await screen.findByText("3 notas de 2 clientes");
    expect(screen.queryByText("Actualizando…")).toBeNull();
    await u.click(screen.getByRole("checkbox", { name: "Solo vencidas" }));
    expect(screen.getByText("Actualizando…")).toBeInTheDocument();
    expect(screen.getByTestId("totales-cuentas")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("tabla-cuentas")).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      soltar({ ...DATOS, notas: 1, clientes: [DATOS.clientes[0]] });
    });
    expect(screen.queryByText("Actualizando…")).toBeNull();
    expect(screen.getByTestId("totales-cuentas")).not.toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("tabla-cuentas")).not.toHaveAttribute("aria-busy", "true");
  });

  it("un cliente dado de baja se marca y no tiene Cobrar", async () => {
    mockAuth(["cuentas_cobrar.ver", "cobranza.registrar"]);
    obtener.mockResolvedValue({ ...DATOS, clientes: [{ ...DATOS.clientes[0], clienteDadoDeBaja: true }, DATOS.clientes[1]] });
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    const baja = await screen.findByRole("button", { name: /Cobach XXI \(dado de baja\)/ });
    await u.click(baja);
    await u.click(screen.getByRole("button", { name: /El Moreno/ }));
    expect(screen.getByText("TJ260913AP05")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cobrar TJ260913AP05" })).toBeNull();
    expect(screen.getByRole("link", { name: "Cobrar MX261001JP01" })).toBeInTheDocument();
  });

  it("la flecha no forma parte del nombre accesible del botón", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    expect(await screen.findByRole("button", { name: "Cobach XXI · TJ" })).toBeInTheDocument();
  });

  it("sin notas lo dice y deshabilita Excel", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    obtener.mockResolvedValue({ hoy: "2026-10-14", totalCentavos: 0, vencidoCentavos: 0, notas: 0, clientes: [] });
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    expect(await screen.findByText("No hay cuentas por cobrar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });

  it("muestra el error del servidor", async () => {
    mockAuth(["cuentas_cobrar.ver"]);
    obtener.mockRejectedValue(new ErrorApi("Forbidden", 403, "No tienes acceso a esa sucursal."));
    render(<PantallaCuentasPorCobrar sucursal="MX" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes acceso a esa sucursal.");
  });

  it("exporta lo que está en pantalla, con la sucursal del usuario atado", async () => {
    mockAuth(["cuentas_cobrar.ver"], "TJ");
    const u = userEvent.setup();
    render(<PantallaCuentasPorCobrar sucursal={null} />);
    await screen.findByText("$377.00");
    await u.click(screen.getByRole("button", { name: "Exportar a Excel" }));
    expect(exportarExcel).toHaveBeenCalledWith(
      cxc.definicionExcelCuentasPorCobrar(DATOS, { sucursal: "TJ", soloVencidas: false }),
    );
  });
});
