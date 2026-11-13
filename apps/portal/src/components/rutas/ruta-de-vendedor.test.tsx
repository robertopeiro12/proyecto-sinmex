import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as clientesLib from "@/lib/clientes";
import type { ClienteResumen } from "@/lib/clientes";
import * as rutasLib from "@/lib/rutas";
import type { FilaRutaDiaria, OpcionesDia, RutaDiaria } from "@/lib/rutas";
import * as semanalesLib from "@/lib/rutas-semanales";
import { RutaDeVendedor } from "./ruta-de-vendedor";

vi.mock("@/lib/clientes");
vi.mock("@/lib/rutas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rutas")>();
  return { ...real, obtenerRutaDiaria: vi.fn(), obtenerOpciones: vi.fn(), guardarRutaDiaria: vi.fn(), obtenerNotas: vi.fn() };
});
vi.mock("@/lib/rutas-semanales", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rutas-semanales")>();
  return { ...real, obtenerRutaSemanal: vi.fn() };
});

const FECHA = "2026-11-10";

const cliente = (id: string, nombre: string): ClienteResumen => ({
  id,
  nombre,
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
});

const fila = (clienteId: string, clienteNombre: string, extra: Partial<FilaRutaDiaria> = {}): FilaRutaDiaria => ({
  id: `r-${clienteId}`,
  clienteId,
  clienteNombre,
  orden: 1,
  origen: "oficina",
  recado: null,
  notasAsignadas: 0,
  ...extra,
});

const rutaDiaria = (extra: Partial<RutaDiaria> = {}): RutaDiaria => ({
  vendedor: { id: "v1", nombre: "Ricardo", sucursalCodigo: "TJ" },
  fecha: FECHA,
  editable: true,
  rutaSemanal: null,
  vehiculo: null,
  filas: [],
  ...extra,
});

const OPCIONES: OpcionesDia = {
  rutas: [
    {
      id: "rs1",
      nombre: "RUTA 1 (OTAY)",
      ocupadaPor: null,
      clientes: [
        { clienteId: "a", nombre: "Abarrotes A", valido: true },
        { clienteId: "baja", nombre: "Dado de baja", valido: false },
        { clienteId: "b", nombre: "Tienda B", valido: true },
      ],
    },
    { id: "rs2", nombre: "RUTA 2 (CENTRO)", ocupadaPor: "Juan", clientes: [] },
    {
      id: "rs3",
      nombre: "RUTA 3 (PLAYAS)",
      ocupadaPor: null,
      clientes: [{ clienteId: "c", nombre: "Carnicería C", valido: true }],
    },
  ],
  vehiculos: [
    { id: "ve1", nombre: "Nissan blanca", ocupadoPor: null },
    { id: "ve2", nombre: "Ford roja", ocupadoPor: "Juan" },
  ],
};

function pintar() {
  const onVolver = vi.fn();
  render(<RutaDeVendedor vendedorId="v1" vendedorNombre="Ricardo" fecha={FECHA} sucursal="TJ" onVolver={onVolver} />);
  return { onVolver, usuario: userEvent.setup() };
}

describe("RutaDeVendedor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientesLib.listarClientes).mockResolvedValue([cliente("a", "Abarrotes A"), cliente("b", "Tienda B")]);
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(rutaDiaria());
    vi.mocked(rutasLib.obtenerOpciones).mockResolvedValue(OPCIONES);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("titula con el vendedor y el día, y trae ← Volver a Ruta Diaria", async () => {
    pintar();
    expect(await screen.findByRole("button", { name: "← Volver a Ruta Diaria" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ruta de Ricardo · martes 10 de noviembre" })).toBeInTheDocument();
    expect(rutasLib.obtenerOpciones).toHaveBeenCalledWith("v1", FECHA);
    expect(clientesLib.listarClientes).toHaveBeenCalledWith("TJ", "cliente");
  });

  it("Asignar notas abre la ventana de notas pendientes del vendedor; en un día pasado no está", async () => {
    vi.mocked(rutasLib.obtenerNotas).mockResolvedValue({ pendientes: [], asignadas: [] });
    const { usuario } = pintar();
    await usuario.click(await screen.findByRole("button", { name: "Asignar notas" }));
    expect(rutasLib.obtenerNotas).toHaveBeenCalledWith("v1", FECHA);
    expect(await screen.findByText("Notas por cobrar de Ricardo · martes 10 de noviembre")).toBeInTheDocument();
  });

  it("un día pasado no ofrece Asignar notas", async () => {
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(rutaDiaria({ editable: false }));
    pintar();
    await screen.findByRole("button", { name: "← Volver a Ruta Diaria" });
    expect(screen.queryByRole("button", { name: "Asignar notas" })).toBeNull();
  });

  it("la ruta que trae otro sale deshabilitada con (la trae Juan); el vehículo de otro sale (lo trae Juan) y sí se escoge", async () => {
    pintar();
    const ruta = await screen.findByRole("option", { name: "RUTA 2 (CENTRO) (la trae Juan)" });
    expect(ruta).toBeDisabled();
    expect(screen.getByRole("option", { name: "Sin ruta" })).toBeInTheDocument();
    const vehiculo = screen.getByRole("option", { name: "Ford roja (lo trae Juan)" });
    expect(vehiculo).toBeEnabled();
    expect(screen.getByRole("option", { name: "Sin vehículo" })).toBeInTheDocument();
  });

  it("la ruta guardada dada de baja se conserva, y al cambiar a otra ya no se puede volver a escoger", async () => {
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(
      rutaDiaria({
        rutaSemanal: { id: "rsx", nombre: "RUTA VIEJA" },
        filas: [fila("a", "Abarrotes A", { origen: "semanal" })],
      }),
    );
    const { usuario } = pintar();
    const lista = await screen.findByLabelText("Ruta del día");
    expect(lista).toHaveValue("rsx");
    expect(screen.getByRole("option", { name: "RUTA VIEJA" })).toBeEnabled();

    await usuario.selectOptions(lista, "rs3");
    await usuario.click(await screen.findByRole("button", { name: "Reemplazar" }));
    expect(screen.getByRole("option", { name: "RUTA VIEJA (dada de baja)" })).toBeDisabled();
  });

  it("escoger una ruta copia sus clientes válidos en su orden, de las opciones (sin pedir la Ruta Semanal)", async () => {
    const { usuario } = pintar();
    await screen.findByRole("option", { name: "RUTA 1 (OTAY)" });

    await usuario.selectOptions(screen.getByLabelText("Ruta del día"), "rs1");

    const lista = await screen.findByRole("region", { name: "Clientes de la ruta" });
    await within(lista).findByText("Tienda B");
    expect(within(lista).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("1Abarrotes A"),
      expect.stringContaining("2Tienda B"),
    ]);
    expect(within(lista).queryByText("Dado de baja")).toBeNull();
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    // `GET /rutas/semanales/:id` exige ruta_semanal.gestionar, que quien arma la ruta del día puede no tener.
    expect(semanalesLib.obtenerRutaSemanal).not.toHaveBeenCalled();
  });

  it("cambiar de ruta con clientes de la semanal pregunta; si no, no cambia nada", async () => {
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(
      rutaDiaria({
        rutaSemanal: { id: "rs1", nombre: "RUTA 1 (OTAY)" },
        filas: [fila("a", "Abarrotes A", { origen: "semanal" }), fila("m", "Mini M", { origen: "oficina" })],
      }),
    );
    const { usuario } = pintar();
    const lista = await screen.findByRole("region", { name: "Clientes de la ruta" });
    await within(lista).findByText("Abarrotes A");

    await usuario.selectOptions(screen.getByLabelText("Ruta del día"), "rs3");
    const pregunta = await screen.findByRole("alertdialog");
    expect(pregunta).toHaveTextContent("¿Reemplazar los clientes de la ruta?");
    await usuario.click(within(pregunta).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByLabelText("Ruta del día")).toHaveValue("rs1");

    await usuario.selectOptions(screen.getByLabelText("Ruta del día"), "rs3");
    await usuario.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reemplazar" }));
    await within(lista).findByText("Carnicería C");
    expect(within(lista).queryByText("Abarrotes A")).toBeNull();
    expect(within(lista).getByText("Mini M")).toBeInTheDocument();
    expect(screen.getByLabelText("Ruta del día")).toHaveValue("rs3");
  });

  it("quitar un cliente con notas asignadas avisa que se le quitarán", async () => {
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(
      rutaDiaria({ filas: [fila("a", "Abarrotes A", { notasAsignadas: 2 }), fila("b", "Tienda B")] }),
    );
    const { usuario } = pintar();
    await usuario.click(await screen.findByRole("button", { name: "Quitar Abarrotes A" }));

    const pregunta = await screen.findByRole("alertdialog");
    expect(pregunta).toHaveTextContent("Abarrotes A tiene 2 notas asignadas; se le quitarán.");
    await usuario.click(within(pregunta).getByRole("button", { name: "Quitar" }));
    const lista = screen.getByRole("region", { name: "Clientes de la ruta" });
    expect(within(lista).queryByText("Abarrotes A")).toBeNull();
  });

  it("quitar un cliente sin notas asignadas no pregunta", async () => {
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(rutaDiaria({ filas: [fila("a", "Abarrotes A")] }));
    const { usuario } = pintar();
    await usuario.click(await screen.findByRole("button", { name: "Quitar Abarrotes A" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const lista = screen.getByRole("region", { name: "Clientes de la ruta" });
    expect(within(lista).queryByText("Abarrotes A")).toBeNull();
  });

  it("el recado se escribe y se ve bajo el nombre", async () => {
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(rutaDiaria({ filas: [fila("a", "Abarrotes A")] }));
    const { usuario } = pintar();
    await usuario.click(await screen.findByRole("button", { name: "Mensaje para Abarrotes A" }));
    fireEvent.change(await screen.findByLabelText("Mensaje"), { target: { value: "  SOLAMENTE COBRAR " } });
    await usuario.click(screen.getByRole("button", { name: "Guardar mensaje" }));

    const lista = screen.getByRole("region", { name: "Clientes de la ruta" });
    expect(within(lista).getByText("SOLAMENTE COBRAR")).toBeInTheDocument();
  });

  it("Guardar manda ruta, vehículo y clientes con recado y regresa a la lista", async () => {
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(
      rutaDiaria({ filas: [fila("a", "Abarrotes A", { recado: "Solo contado" }), fila("b", "Tienda B")] }),
    );
    vi.mocked(rutasLib.guardarRutaDiaria).mockResolvedValue(rutaDiaria());
    const { usuario, onVolver } = pintar();
    await screen.findByRole("option", { name: "Nissan blanca" });

    await usuario.selectOptions(screen.getByLabelText("Vehículo"), "ve2");
    await usuario.click(screen.getByRole("button", { name: "Bajar Abarrotes A" }));
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(rutasLib.guardarRutaDiaria).toHaveBeenCalledWith({
      vendedorId: "v1",
      fecha: FECHA,
      rutaSemanalId: null,
      vehiculoId: "ve2",
      clientes: [
        { clienteId: "b", recado: null },
        { clienteId: "a", recado: "Solo contado" },
      ],
    });
    await vi.waitFor(() => expect(onVolver).toHaveBeenCalledWith(true));
  });

  it("Volver con cambios sin guardar pregunta", async () => {
    const { usuario, onVolver } = pintar();
    await usuario.click(await screen.findByRole("button", { name: "Agregar Tienda B" }));
    await usuario.click(screen.getByRole("button", { name: "← Volver a Ruta Diaria" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("¿Descartar los cambios de la ruta?");
    expect(onVolver).not.toHaveBeenCalled();
  });

  it("un día pasado es solo lectura", async () => {
    vi.mocked(rutasLib.obtenerRutaDiaria).mockResolvedValue(
      rutaDiaria({ editable: false, filas: [fila("a", "Abarrotes A")] }),
    );
    pintar();
    await screen.findByText("Abarrotes A");
    expect(screen.getByLabelText("Ruta del día")).toBeDisabled();
    expect(screen.getByLabelText("Vehículo")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quitar Abarrotes A" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Cartera de clientes" })).toBeNull();
  });
});
