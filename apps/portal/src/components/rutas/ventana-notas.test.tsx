import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as rutasLib from "@/lib/rutas";
import type { NotaDeRuta, NotasDeRuta } from "@/lib/rutas";
import { VentanaNotas } from "./ventana-notas";

vi.mock("@/lib/rutas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rutas")>();
  return { ...real, obtenerNotas: vi.fn(), asignarNota: vi.fn(), quitarNota: vi.fn() };
});

const nota = (extra: Partial<NotaDeRuta>): NotaDeRuta => ({
  ventaNotaId: "n1",
  folio: "TJ261001AP01",
  clienteId: "c1",
  cliente: "Abarrotes Lupe",
  fecha: "2026-11-01",
  saldoCentavos: 25050,
  diasAtraso: 9,
  asignadaA: null,
  ...extra,
});

const LIBRE = nota({});
const MIA = nota({ ventaNotaId: "n2", folio: "TJ261002AP02", cliente: "Tienda Esquina", asignadaA: { vendedorId: "v1", nombre: "Ricardo" } });
const DE_JUAN = nota({ ventaNotaId: "n3", folio: "TJ261003AP03", cliente: "Café Güero", asignadaA: { vendedorId: "v2", nombre: "Juan" } });

const listas = (extra: Partial<NotasDeRuta> = {}): NotasDeRuta => ({
  pendientes: [LIBRE, MIA, DE_JUAN],
  asignadas: [MIA],
  ...extra,
});

function abrir(props: Partial<React.ComponentProps<typeof VentanaNotas>> = {}) {
  const alCerrar = vi.fn();
  render(
    <VentanaNotas
      vendedorId="v1"
      vendedorNombre="Ricardo"
      fecha="2026-11-10"
      editable
      cuales="pendientes"
      alCerrar={alCerrar}
      {...props}
    />,
  );
  return alCerrar;
}

describe("VentanaNotas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rutasLib.obtenerNotas).mockResolvedValue(listas());
  });

  it("pendientes: título, buscador y columnas, con la acción según quién la trae", async () => {
    abrir();
    expect(await screen.findByText("Notas para Ricardo · martes 10 de noviembre")).toBeInTheDocument();
    expect(rutasLib.obtenerNotas).toHaveBeenCalledWith("v1", "2026-11-10");
    expect(screen.getByLabelText("Buscar por folio")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Cliente", "Folio", "Fecha", "Saldo", "Días de atraso", "Acción",
    ]);
    const [, libre, mia, deJuan] = screen.getAllByRole("row");
    expect(libre).toHaveTextContent("Abarrotes Lupe");
    expect(libre).toHaveTextContent("TJ261001AP01");
    expect(libre).toHaveTextContent("250.50");
    expect(within(libre).getByRole("button", { name: "Asignar" })).toBeInTheDocument();
    expect(within(mia).getByRole("button", { name: "Quitar" })).toBeInTheDocument();
    expect(deJuan).toHaveTextContent("La trae Juan");
    expect(within(deJuan).getByRole("button", { name: "Pasársela" })).toBeInTheDocument();
  });

  it("Asignar llama al endpoint y repinta con la respuesta, sin Guardar", async () => {
    const usuario = userEvent.setup();
    vi.mocked(rutasLib.asignarNota).mockResolvedValue(
      listas({ pendientes: [{ ...LIBRE, asignadaA: { vendedorId: "v1", nombre: "Ricardo" } }, MIA, DE_JUAN] }),
    );
    abrir();
    const [, libre] = await screen.findAllByRole("row");
    await usuario.click(within(libre).getByRole("button", { name: "Asignar" }));
    expect(rutasLib.asignarNota).toHaveBeenCalledWith("n1", "v1", "2026-11-10");
    await vi.waitFor(() => expect(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Quitar" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  });

  it("Pasársela y Quitar llaman al endpoint correcto", async () => {
    const usuario = userEvent.setup();
    vi.mocked(rutasLib.asignarNota).mockResolvedValue(listas());
    vi.mocked(rutasLib.quitarNota).mockResolvedValue(listas());
    abrir();
    const filas = await screen.findAllByRole("row");
    await usuario.click(within(filas[3]).getByRole("button", { name: "Pasársela" }));
    expect(rutasLib.asignarNota).toHaveBeenCalledWith("n3", "v1", "2026-11-10");
    await usuario.click(within(screen.getAllByRole("row")[2]).getByRole("button", { name: "Quitar" }));
    expect(rutasLib.quitarNota).toHaveBeenCalledWith("n2", "v1", "2026-11-10");
  });

  it("un error sale en un aviso dentro de la ventana y la lista no cambia", async () => {
    const usuario = userEvent.setup();
    vi.mocked(rutasLib.asignarNota).mockRejectedValue(new ErrorApi("x", 409, "La nota ya no tiene saldo."));
    abrir();
    const [, libre] = await screen.findAllByRole("row");
    await usuario.click(within(libre).getByRole("button", { name: "Asignar" }));
    expect(await screen.findByText("La nota ya no tiene saldo.")).toBeInTheDocument();
    expect(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Asignar" })).toBeInTheDocument();
  });

  it("buscar por folio filtra sin acentos ni mayúsculas", async () => {
    const usuario = userEvent.setup();
    abrir();
    await screen.findAllByRole("row");
    await usuario.type(screen.getByLabelText("Buscar por folio"), "tj261003");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Café Güero")).toBeInTheDocument();
  });

  it("asignadas: lista solo las del vendedor, con Quitar", async () => {
    abrir({ cuales: "asignadas" });
    await screen.findByText("Tienda Esquina");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Quitar" })).toBeInTheDocument();
    expect(screen.queryByText("Abarrotes Lupe")).toBeNull();
  });

  it("solo lectura: sin Asignar, Quitar ni Pasársela", async () => {
    abrir({ editable: false });
    await screen.findByText("Abarrotes Lupe");
    expect(screen.queryByRole("button", { name: /Asignar|Quitar|Pasársela/ })).toBeNull();
    expect(screen.getByText("La trae Juan")).toBeInTheDocument();
  });

  it("sin notas lo dice, y un error al cargar sale en un aviso", async () => {
    vi.mocked(rutasLib.obtenerNotas).mockResolvedValue({ pendientes: [], asignadas: [] });
    abrir();
    expect(await screen.findByText("No hay notas por cobrar.")).toBeInTheDocument();
  });

  it("Cerrar avisa para que la lista del día relea sus conteos", async () => {
    const usuario = userEvent.setup();
    const alCerrar = abrir();
    await screen.findByText("Abarrotes Lupe");
    await usuario.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(alCerrar).toHaveBeenCalled();
  });
});
