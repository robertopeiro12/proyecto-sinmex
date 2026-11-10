import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as semanalesLib from "@/lib/rutas-semanales";
import type { RutaSemanalDetalle } from "@/lib/rutas-semanales";
import { EditarRutaSemanal } from "./editar-ruta-semanal";

vi.mock("@/lib/clientes");
vi.mock("@/lib/rutas-semanales", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rutas-semanales")>();
  return {
    ...real,
    obtenerRutaSemanal: vi.fn(),
    guardarClientesRutaSemanal: vi.fn(),
    renombrarRutaSemanal: vi.fn(),
    eliminarRutaSemanal: vi.fn(),
  };
});

const cliente = (id: string, nombre: string): ClienteResumen => ({
  id,
  nombre,
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
});
const detalle = (lista: RutaSemanalDetalle["lista"]): RutaSemanalDetalle => ({
  id: "r1",
  diaSemana: 2,
  nombre: "Centro",
  clientes: lista.length,
  sucursalCodigo: "TJ",
  lista,
});

async function abrir(volver = vi.fn()) {
  const usuario = userEvent.setup();
  render(<EditarRutaSemanal id="r1" sucursal="TJ" onVolver={volver} />);
  await screen.findByText(/Clientes de la ruta:/);
  return { usuario, volver };
}

describe("EditarRutaSemanal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([
      cliente("a", "Abarrotes A"),
      cliente("b", "Tienda B"),
      cliente("c", "Café Ñandú"),
      cliente("d", "Dulcería D"),
    ]);
    vi.mocked(semanalesLib.obtenerRutaSemanal).mockResolvedValue(
      detalle([{ clienteId: "a", nombre: "Abarrotes A", valido: true }]),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("carga los clientes de la sucursal y la lista, con 'Clientes de la ruta: N'", async () => {
    await abrir();
    expect(clientesLib.listarClientes).toHaveBeenCalledWith("TJ", "cliente");
    expect(screen.getByText("Clientes de la ruta: 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar Tienda B" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar Abarrotes A" })).toBeNull();
  });

  it("el buscador ignora acentos y mayúsculas", async () => {
    const { usuario } = await abrir();
    await usuario.type(screen.getByLabelText("Buscar cliente"), "cafe nandu");
    expect(screen.getByRole("button", { name: "Agregar Café Ñandú" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar Tienda B" })).toBeNull();
  });

  it("Guardar manda los ids en el orden en que se agregaron", async () => {
    vi.mocked(semanalesLib.guardarClientesRutaSemanal).mockResolvedValue(
      detalle([
        { clienteId: "a", nombre: "Abarrotes A", valido: true },
        { clienteId: "d", nombre: "Dulcería D", valido: true },
        { clienteId: "b", nombre: "Tienda B", valido: true },
      ]),
    );
    const { usuario } = await abrir();
    await usuario.click(screen.getByRole("button", { name: "Agregar Dulcería D" }));
    await usuario.click(screen.getByRole("button", { name: "Agregar Tienda B" }));
    expect(screen.getByText("Clientes de la ruta: 3")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(semanalesLib.guardarClientesRutaSemanal).toHaveBeenCalledWith("r1", ["a", "d", "b"]);
    expect(await screen.findByText("Ruta guardada.")).toBeInTheDocument();
  });

  it("quitar saca al cliente de la lista y lo devuelve a la izquierda", async () => {
    const { usuario } = await abrir();
    await usuario.click(screen.getByRole("button", { name: "Quitar Abarrotes A" }));
    expect(screen.getByText("Clientes de la ruta: 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar Abarrotes A" })).toBeInTheDocument();
  });

  it("un cliente no válido sale con la etiqueta 'dado de baja' y se puede quitar", async () => {
    vi.mocked(semanalesLib.obtenerRutaSemanal).mockResolvedValue(
      detalle([{ clienteId: "x", nombre: "Viejo X", valido: false }]),
    );
    const { usuario } = await abrir();
    expect(screen.getByText("dado de baja")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Quitar Viejo X" }));
    expect(screen.getByText("Clientes de la ruta: 0")).toBeInTheDocument();
  });

  it("salir sin cambios vuelve directo; con cambios pregunta", async () => {
    const { usuario, volver } = await abrir();
    await usuario.click(screen.getByRole("button", { name: "← Volver a Ruta Semanal" }));
    expect(volver).toHaveBeenCalledTimes(1);

    await usuario.click(screen.getByRole("button", { name: "Agregar Tienda B" }));
    await usuario.click(screen.getByRole("button", { name: "← Volver a Ruta Semanal" }));
    expect(await screen.findByText("¿Descartar los cambios de la ruta?")).toBeInTheDocument();
    expect(volver).toHaveBeenCalledTimes(1);
    await usuario.click(screen.getByRole("button", { name: "Descartar cambios" }));
    await waitFor(() => expect(volver).toHaveBeenCalledTimes(2));
  });

  it("eliminar confirma, borra y vuelve", async () => {
    vi.mocked(semanalesLib.eliminarRutaSemanal).mockResolvedValue();
    const { usuario, volver } = await abrir();
    await usuario.click(screen.getByRole("button", { name: "Eliminar ruta" }));
    expect(semanalesLib.eliminarRutaSemanal).not.toHaveBeenCalled();
    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(semanalesLib.eliminarRutaSemanal).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(volver).toHaveBeenCalled());
  });

  it("eliminar con 409 muestra el motivo en un Aviso y no vuelve", async () => {
    vi.mocked(semanalesLib.eliminarRutaSemanal).mockRejectedValue(
      new ErrorApi("conflicto", 409, "Esta ruta está asignada a Abraham el 12 de noviembre."),
    );
    const { usuario, volver } = await abrir();
    await usuario.click(screen.getByRole("button", { name: "Eliminar ruta" }));
    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText(/asignada a Abraham/)).toBeInTheDocument();
    expect(volver).not.toHaveBeenCalled();
  });

  it("renombrar manda el nombre nuevo", async () => {
    vi.mocked(semanalesLib.renombrarRutaSemanal).mockResolvedValue({ ...detalle([]), nombre: "Zona Norte" });
    const { usuario } = await abrir();
    const campo = screen.getByLabelText("Nombre de la ruta");
    await usuario.clear(campo);
    await usuario.type(campo, "Zona Norte");
    await usuario.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(semanalesLib.renombrarRutaSemanal).toHaveBeenCalledWith("r1", "Zona Norte");
    expect(await within(document.body).findByText("Nombre guardado.")).toBeInTheDocument();
  });
});
