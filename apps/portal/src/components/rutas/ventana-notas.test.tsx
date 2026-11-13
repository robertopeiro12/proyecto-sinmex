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
const MIA = nota({
  ventaNotaId: "n2",
  folio: "TJ261002AP02",
  clienteId: "c2",
  cliente: "Tienda Esquina",
  saldoCentavos: 10000,
  diasAtraso: 0,
  asignadaA: { vendedorId: "v1", nombre: "Ricardo", condicionVenta: "abonar" },
});
const DE_JUAN = nota({
  ventaNotaId: "n3",
  folio: "TJ261003AP03",
  clienteId: "c3",
  cliente: "Café Güero",
  asignadaA: { vendedorId: "v2", nombre: "Juan", condicionVenta: "liquidar" },
});
// Otra nota de Abarrotes Lupe: va en el mismo grupo que LIBRE.
const LIBRE_2 = nota({ ventaNotaId: "n4", folio: "TJ261004AP04", saldoCentavos: 4950 });

const listas = (extra: Partial<NotasDeRuta> = {}): NotasDeRuta => ({
  pendientes: [LIBRE, MIA, DE_JUAN],
  asignadas: [MIA],
  ...extra,
});

/** El renglón de una nota, por su folio. */
const fila = (folio: string) => screen.getByText(folio).closest("tr") as HTMLElement;
const condicion = (folio: string, texto: string) =>
  within(screen.getByRole("radiogroup", { name: `Condición de la nota ${folio}` })).getByRole("radio", { name: texto });

function abrir(props: Partial<React.ComponentProps<typeof VentanaNotas>> = {}) {
  const alCerrar = vi.fn();
  render(
    <VentanaNotas
      vendedorId="v1"
      vendedorNombre="Ricardo López"
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

  it("título, resumen, filtro, buscador y columnas; la acción según quién la trae", async () => {
    abrir();
    expect(await screen.findByText("Notas por cobrar de Ricardo López · martes 10 de noviembre")).toBeInTheDocument();
    expect(rutasLib.obtenerNotas).toHaveBeenCalledWith("v1", "2026-11-10");
    expect(await screen.findByText(/Ricardo López trae/)).toHaveTextContent("Ricardo López trae 1 nota · $100.00");
    expect(screen.getByRole("radio", { name: "Todas" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Asignadas a Ricardo (1)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar por folio")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Folio", "Fecha", "Saldo", "Atraso", "Condición", "Acción",
    ]);
    const libre = fila("TJ261001AP01");
    expect(libre).toHaveTextContent("250.50");
    expect(libre).toHaveTextContent("9 días");
    expect(within(libre).getByRole("button", { name: "Asignar" })).toBeInTheDocument();
    const mia = fila("TJ261002AP02");
    expect(mia).toHaveTextContent("Al día");
    expect(mia.className).toContain("bg-primary/5");
    expect(within(mia).getByRole("button", { name: "Quitar" })).toBeInTheDocument();
    const deJuan = fila("TJ261003AP03");
    expect(deJuan).toHaveTextContent("La trae Juan");
    expect(deJuan.className).toContain("text-muted-foreground");
    expect(within(deJuan).getByRole("button", { name: "Pasársela" })).toBeInTheDocument();
  });

  it("agrupa por cliente en el orden de la ruta, con cuántas notas y su total; sin repetir las asignadas", async () => {
    vi.mocked(rutasLib.obtenerNotas).mockResolvedValue(listas({ pendientes: [LIBRE, MIA, DE_JUAN, LIBRE_2] }));
    abrir();
    await screen.findByText("TJ261001AP01");
    const grupos = screen.getAllByRole("rowheader");
    expect(grupos.map((g) => g.textContent)).toEqual([
      "Abarrotes Lupe2 notas · $300.00",
      "Tienda Esquina1 nota · $100.00",
      "Café Güero1 nota · $250.50",
    ]);
    expect(screen.getAllByText("TJ261002AP02")).toHaveLength(1);
    // Las dos de Abarrotes Lupe van juntas debajo de su cliente.
    const filas = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    const lupe = filas.findIndex((t) => t.startsWith("Abarrotes Lupe"));
    expect(filas[lupe + 1]).toContain("TJ261001AP01");
    expect(filas[lupe + 2]).toContain("TJ261004AP04");
  });

  it("una asignada que ya no está en pendientes también sale, en su grupo", async () => {
    vi.mocked(rutasLib.obtenerNotas).mockResolvedValue(listas({ pendientes: [LIBRE], asignadas: [MIA] }));
    abrir();
    expect(await screen.findByText("TJ261002AP02")).toBeInTheDocument();
    expect(screen.getByText("Tienda Esquina")).toBeInTheDocument();
  });

  it("el filtro 'Asignadas a…' deja solo las propias", async () => {
    const usuario = userEvent.setup();
    abrir();
    await screen.findByText("TJ261001AP01");
    await usuario.click(screen.getByRole("radio", { name: "Asignadas a Ricardo (1)" }));
    expect(screen.getByText("TJ261002AP02")).toBeInTheDocument();
    expect(screen.queryByText("TJ261001AP01")).toBeNull();
    expect(screen.queryByText("TJ261003AP03")).toBeNull();
    expect(screen.queryByText("Abarrotes Lupe")).toBeNull();
  });

  it("cuales='asignadas' abre con el filtro de las propias", async () => {
    abrir({ cuales: "asignadas" });
    await screen.findByText("TJ261002AP02");
    expect(screen.getByRole("radio", { name: "Asignadas a Ricardo (1)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("TJ261001AP01")).toBeNull();
    expect(screen.getByRole("button", { name: "Quitar" })).toBeInTheDocument();
  });

  it("sin asignadas el resumen lo dice", async () => {
    vi.mocked(rutasLib.obtenerNotas).mockResolvedValue(listas({ pendientes: [LIBRE], asignadas: [] }));
    abrir();
    expect(await screen.findByText("Ricardo López no trae notas asignadas")).toBeInTheDocument();
  });

  it("Asignar llama al endpoint y repinta con la respuesta, sin Guardar", async () => {
    const usuario = userEvent.setup();
    const asignada = { ...LIBRE, asignadaA: { vendedorId: "v1", nombre: "Ricardo", condicionVenta: "ninguna" as const } };
    vi.mocked(rutasLib.asignarNota).mockResolvedValue(listas({ pendientes: [asignada, MIA, DE_JUAN], asignadas: [asignada, MIA] }));
    abrir();
    await screen.findByText("TJ261001AP01");
    await usuario.click(within(fila("TJ261001AP01")).getByRole("button", { name: "Asignar" }));
    expect(rutasLib.asignarNota).toHaveBeenCalledWith("n1", "v1", "2026-11-10", "ninguna");
    await vi.waitFor(() => expect(within(fila("TJ261001AP01")).getByRole("button", { name: "Quitar" })).toBeInTheDocument());
    expect(screen.getByText(/Ricardo López trae/)).toHaveTextContent("trae 2 notas · $350.50");
    expect(screen.getByRole("radio", { name: "Asignadas a Ricardo (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  });

  it("Pasársela y Quitar llaman al endpoint correcto", async () => {
    const usuario = userEvent.setup();
    vi.mocked(rutasLib.asignarNota).mockResolvedValue(listas());
    vi.mocked(rutasLib.quitarNota).mockResolvedValue(listas());
    abrir();
    await screen.findByText("TJ261003AP03");
    await usuario.click(within(fila("TJ261003AP03")).getByRole("button", { name: "Pasársela" }));
    expect(rutasLib.asignarNota).toHaveBeenCalledWith("n3", "v1", "2026-11-10", "liquidar");
    await usuario.click(within(fila("TJ261002AP02")).getByRole("button", { name: "Quitar" }));
    expect(rutasLib.quitarNota).toHaveBeenCalledWith("n2", "v1", "2026-11-10");
  });

  it("asignar manda la condición elegida", async () => {
    const usuario = userEvent.setup();
    vi.mocked(rutasLib.asignarNota).mockResolvedValue(listas());
    abrir();
    await screen.findByText("TJ261001AP01");
    await usuario.click(condicion("TJ261001AP01", "Solo si liquida"));
    await usuario.click(within(fila("TJ261001AP01")).getByRole("button", { name: "Asignar" }));
    expect(rutasLib.asignarNota).toHaveBeenCalledWith("n1", "v1", "2026-11-10", "liquidar");
  });

  it("una nota asignada con 'liquidar' y luego quitada vuelve a 'Puede vender'", async () => {
    const usuario = userEvent.setup();
    const asignada = { ...LIBRE, asignadaA: { vendedorId: "v1", nombre: "Ricardo", condicionVenta: "liquidar" as const } };
    vi.mocked(rutasLib.asignarNota).mockResolvedValue(listas({ pendientes: [asignada, MIA, DE_JUAN] }));
    vi.mocked(rutasLib.quitarNota).mockResolvedValue(listas());
    abrir();
    await screen.findByText("TJ261001AP01");
    await usuario.click(condicion("TJ261001AP01", "Solo si liquida"));
    await usuario.click(within(fila("TJ261001AP01")).getByRole("button", { name: "Asignar" }));
    await usuario.click(await within(fila("TJ261001AP01")).findByRole("button", { name: "Quitar" }));
    await vi.waitFor(() => expect(condicion("TJ261001AP01", "Puede vender")).toHaveAttribute("aria-checked", "true"));
  });

  it("sin tocar la condición asigna con 'ninguna'", async () => {
    const usuario = userEvent.setup();
    vi.mocked(rutasLib.asignarNota).mockResolvedValue(listas());
    abrir();
    await screen.findByText("TJ261001AP01");
    expect(condicion("TJ261001AP01", "Puede vender")).toHaveAttribute("aria-checked", "true");
    await usuario.click(within(fila("TJ261001AP01")).getByRole("button", { name: "Asignar" }));
    expect(rutasLib.asignarNota).toHaveBeenCalledWith("n1", "v1", "2026-11-10", "ninguna");
  });

  it("una asignada a este vendedor muestra su condición corta y no tiene selector", async () => {
    abrir();
    await screen.findByText("TJ261002AP02");
    const mia = fila("TJ261002AP02");
    expect(within(mia).getByText("Solo si abona")).toBeInTheDocument();
    expect(within(mia).queryByRole("radiogroup")).toBeNull();
  });

  it("pasársela manda la condición del selector, que arranca con la que tenía", async () => {
    const usuario = userEvent.setup();
    vi.mocked(rutasLib.asignarNota).mockResolvedValue(listas());
    abrir();
    await screen.findByText("TJ261003AP03");
    expect(condicion("TJ261003AP03", "Solo si liquida")).toHaveAttribute("aria-checked", "true");
    await usuario.click(condicion("TJ261003AP03", "Puede vender"));
    await usuario.click(within(fila("TJ261003AP03")).getByRole("button", { name: "Pasársela" }));
    expect(rutasLib.asignarNota).toHaveBeenCalledWith("n3", "v1", "2026-11-10", "ninguna");
  });

  it("un error sale en un aviso dentro de la ventana y la lista no cambia", async () => {
    const usuario = userEvent.setup();
    vi.mocked(rutasLib.asignarNota).mockRejectedValue(new ErrorApi("x", 409, "La nota ya no tiene saldo."));
    abrir();
    await screen.findByText("TJ261001AP01");
    await usuario.click(within(fila("TJ261001AP01")).getByRole("button", { name: "Asignar" }));
    expect(await screen.findByText("La nota ya no tiene saldo.")).toBeInTheDocument();
    expect(within(fila("TJ261001AP01")).getByRole("button", { name: "Asignar" })).toBeInTheDocument();
  });

  it("buscar por folio filtra sin acentos ni mayúsculas y no pinta grupos vacíos", async () => {
    const usuario = userEvent.setup();
    abrir();
    await screen.findByText("TJ261001AP01");
    await usuario.type(screen.getByLabelText("Buscar por folio"), "tj261003");
    expect(screen.getByText("TJ261003AP03")).toBeInTheDocument();
    expect(screen.getByText("Café Güero")).toBeInTheDocument();
    expect(screen.queryByText("Abarrotes Lupe")).toBeNull();
    expect(screen.getAllByRole("rowheader")).toHaveLength(1);
  });

  it("solo lectura: sin Asignar, Quitar ni Pasársela", async () => {
    abrir({ editable: false });
    await screen.findByText("TJ261001AP01");
    expect(screen.queryByRole("button", { name: /Asignar|Quitar|Pasársela/ })).toBeNull();
    expect(screen.getByText("La trae Juan")).toBeInTheDocument();
    expect(within(fila("TJ261002AP02")).getByText("Asignada")).toBeInTheDocument();
  });

  it("en solo lectura la condición es texto", async () => {
    abrir({ editable: false });
    await screen.findByText("TJ261001AP01");
    expect(screen.queryByRole("radiogroup", { name: /Condición/ })).toBeNull();
    expect(fila("TJ261001AP01")).not.toHaveTextContent(/Puede vender|Solo si/);
    expect(fila("TJ261002AP02")).toHaveTextContent("Solo si abona");
    expect(fila("TJ261003AP03")).toHaveTextContent("Solo si liquida");
  });

  it("sin notas lo dice", async () => {
    vi.mocked(rutasLib.obtenerNotas).mockResolvedValue({ pendientes: [], asignadas: [] });
    abrir();
    expect(await screen.findByText("No hay notas por cobrar en la ruta de este día.")).toBeInTheDocument();
  });

  it("un error al cargar sale en un aviso", async () => {
    vi.mocked(rutasLib.obtenerNotas).mockRejectedValue(new ErrorApi("x", 500, "No se pudieron cargar las notas."));
    abrir();
    expect(await screen.findByText("No se pudieron cargar las notas.")).toBeInTheDocument();
    expect(screen.queryByText("Cargando…")).toBeNull();
  });

  it("Cerrar avisa para que la lista del día relea sus conteos", async () => {
    const usuario = userEvent.setup();
    const alCerrar = abrir();
    await screen.findByText("TJ261001AP01");
    await usuario.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(alCerrar).toHaveBeenCalled();
  });
});
