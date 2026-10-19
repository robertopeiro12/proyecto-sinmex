import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as lib from "@/lib/tesoreria";
import type { DestinosSucursal } from "@/lib/tesoreria";
import { hoyEnTijuana } from "@/lib/ventas";
import { SeccionDestinos } from "./seccion-destinos";

vi.mock("@/lib/tesoreria", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tesoreria")>();
  return { ...real, obtenerDestinos: vi.fn(), guardarDestino: vi.fn() };
});

const HOY = hoyEnTijuana();
const CUENTAS = [
  { id: "ef", nombre: "Efectivo TJ", sucursalId: "s-tj", sucursalCodigo: "TJ" },
  { id: "mx", nombre: "Efectivo MX", sucursalId: "s-mx", sucursalCodigo: "MX" },
  { id: "sc", nombre: "ScotiaFiscal", sucursalId: null, sucursalCodigo: null },
];
const DESTINOS: DestinosSucursal[] = [
  {
    sucursalId: "s-tj",
    sucursalCodigo: "TJ",
    sucursalNombre: "Tijuana",
    vigentes: {
      efectivo: { id: "d1", sucursalId: "s-tj", sucursalCodigo: "TJ", metodo: "efectivo", cuentaId: "ef", cuentaNombre: "Efectivo TJ", desde: "2026-10-01" },
      transferencia: null,
      cheque: null,
    },
    historial: [{ id: "d1", sucursalId: "s-tj", sucursalCodigo: "TJ", metodo: "efectivo", cuentaId: "ef", cuentaNombre: "Efectivo TJ", desde: "2026-10-01" }],
  },
];

describe("SeccionDestinos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.obtenerDestinos).mockResolvedValue(DESTINOS);
    vi.mocked(lib.guardarDestino).mockResolvedValue(DESTINOS[0].historial[0]);
  });

  it("una fila por sucursal con lo vigente; opciones = cuentas de esa sucursal + generales", async () => {
    render(<SeccionDestinos sucursal={null} cuentas={CUENTAS} />);
    const fila = (await screen.findByText("TJ · Tijuana")).closest("tr")!;
    const efectivo = within(fila).getByLabelText("Efectivo de TJ") as HTMLSelectElement;
    expect(efectivo.value).toBe("ef");
    const opciones = [...efectivo.options].map((o) => o.textContent);
    expect(opciones).toEqual(["Efectivo TJ", "ScotiaFiscal · General"]);
    expect(within(fila).getByLabelText("Transferencia de TJ")).toHaveValue("");
  });

  it("Guardar manda solo los métodos cambiados, con la fecha desde (hoy por defecto)", async () => {
    render(<SeccionDestinos sucursal={null} cuentas={CUENTAS} />);
    const fila = (await screen.findByText("TJ · Tijuana")).closest("tr")!;
    await userEvent.selectOptions(within(fila).getByLabelText("Transferencia de TJ"), "sc");
    await userEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
    expect(lib.guardarDestino).toHaveBeenCalledTimes(1);
    expect(lib.guardarDestino).toHaveBeenCalledWith({ sucursalId: "s-tj", metodo: "transferencia", cuentaId: "sc", desde: HOY });
    expect(lib.obtenerDestinos).toHaveBeenCalledTimes(2);
  });

  it("guardar con un 'desde' anterior al vigente avisa que hoy sigue rigiendo el actual", async () => {
    render(<SeccionDestinos sucursal={null} cuentas={CUENTAS} />);
    const fila = (await screen.findByText("TJ · Tijuana")).closest("tr")!;
    await userEvent.selectOptions(within(fila).getByLabelText("Efectivo de TJ"), "sc");
    fireEvent.change(within(fila).getByLabelText("Desde, TJ"), { target: { value: "2026-09-15" } });
    await userEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent("Guardado desde 15/09/2026; hoy sigue vigente Efectivo TJ desde 01/10/2026.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si un método falla tras guardar otro, recarga y nombra el que falló", async () => {
    vi.mocked(lib.guardarDestino).mockResolvedValueOnce(DESTINOS[0].historial[0]).mockRejectedValueOnce(new Error("Cuenta inválida"));
    render(<SeccionDestinos sucursal={null} cuentas={CUENTAS} />);
    const fila = (await screen.findByText("TJ · Tijuana")).closest("tr")!;
    await userEvent.selectOptions(within(fila).getByLabelText("Transferencia de TJ"), "sc");
    await userEvent.selectOptions(within(fila).getByLabelText("Cheque de TJ"), "sc");
    await userEvent.click(within(fila).getByRole("button", { name: "Guardar" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("No se pudo guardar cheque de TJ");
    expect(lib.obtenerDestinos).toHaveBeenCalledTimes(2);
  });

  it("muestra el destino vigente aunque su cuenta no esté en la lista", async () => {
    render(<SeccionDestinos sucursal={null} cuentas={[CUENTAS[2]]} />);
    const fila = (await screen.findByText("TJ · Tijuana")).closest("tr")!;
    expect(within(fila).getByLabelText("Efectivo de TJ")).toHaveValue("ef");
  });

  it("muestra el historial de cambios", async () => {
    render(<SeccionDestinos sucursal={null} cuentas={CUENTAS} />);
    expect(await screen.findByText("TJ · Efectivo → Efectivo TJ desde 01/10/2026")).toBeInTheDocument();
  });
});
