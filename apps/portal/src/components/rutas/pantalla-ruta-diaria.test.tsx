import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as rutasLib from "@/lib/rutas";
import type { RutaDiaria } from "@/lib/rutas";
import * as vendedoresLib from "@/lib/vendedores";
import type { Vendedor } from "@/lib/vendedores";
import { AVISO_CAMBIOS, PantallaRutaDiaria } from "./pantalla-ruta-diaria";

vi.mock("@/lib/clientes");
vi.mock("@/lib/vendedores");
vi.mock("@/lib/rutas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rutas")>();
  return {
    ...real,
    obtenerRutaDiaria: vi.fn(),
    guardarRutaDiaria: vi.fn(),
    obtenerRutaAnterior: vi.fn(),
  };
});
vi.mock("@/components/auth/auth-provider");

const VENDEDOR: Vendedor = {
  id: "v1",
  nombre: "Abraham Pérez",
  login: "aperez",
  sucursalId: "s-tj",
  sucursalCodigo: "TJ",
  folioSegmento: "AP",
  activo: true,
};
const cliente = (id: string, nombre: string): ClienteResumen => ({
  id,
  nombre,
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
});
const ruta = (filas: RutaDiaria["filas"]): RutaDiaria => ({
  vendedor: { id: "v1", nombre: "Abraham Pérez", sucursalCodigo: "TJ" },
  fecha: "2026-10-12",
  filas,
});
const FILA_A = { id: "r1", clienteId: "a", clienteNombre: "Abarrotes A", orden: 1, origen: "oficina" as const };

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

async function elegirVendedor(usuario: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: /Abraham Pérez/ });
  await usuario.selectOptions(screen.getByLabelText("Vendedor"), "v1");
  await screen.findByText("Abarrotes A");
}

describe("PantallaRutaDiaria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vendedoresLib.listarVendedores).mockResolvedValue([
      VENDEDOR,
      { ...VENDEDOR, id: "v2", nombre: "Inactivo", activo: false },
    ]);
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([
      cliente("a", "Abarrotes A"),
      cliente("b", "Tienda B"),
    ]);
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(ruta([FILA_A]));
  });

  it("sin ruta_diaria.gestionar lo dice y no pide nada", () => {
    mockAuth(() => false);
    render(<PantallaRutaDiaria sucursal={null} />);
    expect(screen.getByText("No tienes permiso para gestionar la ruta diaria")).toBeInTheDocument();
    expect(vendedoresLib.listarVendedores).not.toHaveBeenCalled();
  });

  it("solo ofrece vendedores activos; al elegir uno carga su ruta y la cartera de su sucursal", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal="todas" />);

    await elegirVendedor(usuario);

    expect(screen.queryByRole("option", { name: /Inactivo/ })).toBeNull();
    expect(vendedoresLib.listarVendedores).toHaveBeenCalledWith("todas");
    expect(clientesLib.listarClientes).toHaveBeenCalledWith("TJ", "cliente");
    expect(rutasLib.obtenerRutaDiaria).toHaveBeenCalledWith("v1", expect.any(String));
  });

  it("agregar no guarda; Guardar ruta manda la lista completa y limpia el aviso", async () => {
    mockAuth(() => true);
    vi.mocked(rutasLib.guardarRutaDiaria).mockResolvedValue(
      ruta([FILA_A, { id: "r2", clienteId: "b", clienteNombre: "Tienda B", orden: 2, origen: "oficina" }]),
    );
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal={null} />);
    await elegirVendedor(usuario);

    await usuario.click(screen.getByRole("button", { name: "Agregar Tienda B" }));
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    expect(rutasLib.guardarRutaDiaria).not.toHaveBeenCalled();

    await usuario.click(screen.getByRole("button", { name: "Guardar ruta" }));

    expect(rutasLib.guardarRutaDiaria).toHaveBeenCalledWith({
      vendedorId: "v1",
      fecha: expect.any(String) as string,
      clientes: ["a", "b"],
    });
    expect(await screen.findByText("Ruta guardada.")).toBeInTheDocument();
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  });

  it("Copiar de ayer carga la ruta anterior sin guardar", async () => {
    mockAuth(() => true);
    vi.mocked(rutasLib.obtenerRutaAnterior).mockResolvedValue({ fecha: "2026-10-11", clientes: ["b"] });
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal={null} />);
    await elegirVendedor(usuario);

    await usuario.click(screen.getByRole("button", { name: "Copiar de ayer" }));

    const lista = screen.getByRole("region", { name: "Ruta del día" });
    expect(await within(lista).findByText("Tienda B")).toBeInTheDocument();
    expect(within(lista).queryByText("Abarrotes A")).toBeNull();
    expect(screen.getByText("Se cargó la ruta del 2026-10-11. Revísala y guarda.")).toBeInTheDocument();
    expect(rutasLib.guardarRutaDiaria).not.toHaveBeenCalled();
  });

  it("con cambios sin guardar, cambiar la fecha pregunta; si cancela, se queda", async () => {
    mockAuth(() => true);
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal={null} />);
    await elegirVendedor(usuario);
    await usuario.click(screen.getByRole("button", { name: "Agregar Tienda B" }));

    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2030-01-01" } });

    expect(confirmar).toHaveBeenCalledWith(AVISO_CAMBIOS);
    expect(rutasLib.obtenerRutaDiaria).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    confirmar.mockRestore();
  });

  it("si guardar falla, muestra el mensaje del servidor y conserva las ediciones para reintentar", async () => {
    mockAuth(() => true);
    vi.mocked(rutasLib.guardarRutaDiaria).mockRejectedValue(new ErrorApi("HTTP 400", 400, "El cliente ya no existe"));
    const usuario = userEvent.setup();
    render(<PantallaRutaDiaria sucursal={null} />);
    await elegirVendedor(usuario);
    await usuario.click(screen.getByRole("button", { name: "Agregar Tienda B" }));

    await usuario.click(screen.getByRole("button", { name: "Guardar ruta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("El cliente ya no existe");
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    const lista = screen.getByRole("region", { name: "Ruta del día" });
    expect(within(lista).getByText("Tienda B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar ruta" })).toBeEnabled();
  });
});
