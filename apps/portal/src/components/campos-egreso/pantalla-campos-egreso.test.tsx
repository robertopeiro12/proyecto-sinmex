import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as lib from "@/lib/campos-egreso";
import { PantallaCamposEgreso } from "./pantalla-campos-egreso";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/campos-egreso", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campos-egreso")>();
  return {
    ...real,
    listarCamposEgreso: vi.fn(),
    crearCampoEgreso: vi.fn(),
    editarCampoEgreso: vi.fn(),
    eliminarCampoEgreso: vi.fn(),
  };
});

const CAMPOS: lib.CampoEgreso[] = [
  { id: "c1", nombre: "Gasolina", tipo: "operacion", seUsaEnApp: true },
  { id: "c2", nombre: "Envases", tipo: "produccion", seUsaEnApp: false },
];

function sesion(puede: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { sucursal: null, permisos: puede ? [lib.PERMISO_CAMPOS_EGRESO] : [] } as never,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => puede,
  });
}

describe("PantallaCamposEgreso", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.listarCamposEgreso).mockResolvedValue(CAMPOS);
  });

  it("lista nombre, tipo con su etiqueta y la casilla en Sí/No; con permiso, Editar y Eliminar", async () => {
    sesion(true);
    render(<PantallaCamposEgreso />);
    const tabla = (await screen.findByText("Gasolina")).closest("table")!;
    expect(within(tabla).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(
      expect.arrayContaining(["Nombre", "Tipo", "Se usa en la app"]),
    );
    const gasolina = within(tabla).getByText("Gasolina").closest("tr")!;
    expect(within(gasolina).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      expect.arrayContaining(["Gasolina", "Operación", "Sí"]),
    );
    const envases = within(tabla).getByText("Envases").closest("tr")!;
    expect(within(envases).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      expect.arrayContaining(["Envases", "Producción", "No"]),
    );
    expect(within(gasolina).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(within(gasolina).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo campo" })).toBeInTheDocument();
  });

  it("sin campo_egreso.gestionar solo se lee: sin alta ni botones por fila", async () => {
    sesion(false);
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Gasolina")).closest("tr")!;
    expect(within(fila).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo campo" })).toBeNull();
  });

  it("el alta manda nombre, tipo y la casilla; el tipo arranca en Operación", async () => {
    sesion(true);
    vi.mocked(lib.crearCampoEgreso).mockResolvedValue({ id: "c3", nombre: "Renta", tipo: "financiero", seUsaEnApp: true });
    render(<PantallaCamposEgreso />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo campo" }));
    expect(screen.getByLabelText("Tipo")).toHaveValue("operacion");
    expect(within(screen.getByLabelText("Tipo")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Producción",
      "Operación",
      "Financiero",
    ]);
    await userEvent.type(screen.getByLabelText("Nombre del campo"), "Renta");
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "financiero");
    await userEvent.click(screen.getByLabelText("Se usa en la app"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.crearCampoEgreso).toHaveBeenCalledWith({ nombre: "Renta", tipo: "financiero", seUsaEnApp: true });
    await vi.waitFor(() => expect(lib.listarCamposEgreso).toHaveBeenCalledTimes(2));
  });

  it("editar precarga el campo y manda lo cambiado", async () => {
    sesion(true);
    vi.mocked(lib.editarCampoEgreso).mockResolvedValue({ ...CAMPOS[0], seUsaEnApp: false });
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Gasolina")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Nombre del campo")).toHaveValue("Gasolina");
    expect(screen.getByLabelText("Tipo")).toHaveValue("operacion");
    expect(screen.getByLabelText("Se usa en la app")).toBeChecked();
    await userEvent.click(screen.getByLabelText("Se usa en la app"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.editarCampoEgreso).toHaveBeenCalledWith("c1", { nombre: "Gasolina", tipo: "operacion", seUsaEnApp: false });
  });

  it("un nombre repetido muestra el mensaje del servidor (409)", async () => {
    sesion(true);
    vi.mocked(lib.crearCampoEgreso).mockRejectedValue(
      new ErrorApi("conflicto", 409, 'Ya existe un campo de egreso llamado "Gasolina".'),
    );
    render(<PantallaCamposEgreso />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo campo" }));
    await userEvent.type(screen.getByLabelText("Nombre del campo"), "gasolina");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('Ya existe un campo de egreso llamado "Gasolina".');
  });

  it("eliminar pide confirmación, da de baja y recarga", async () => {
    sesion(true);
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(lib.eliminarCampoEgreso).mockResolvedValue({ id: "c2" });
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Envases")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(confirmar).toHaveBeenCalledWith(
      '¿Seguro que quieres eliminar el campo "Envases"? Los gastos ya registrados lo conservan, pero las tablets dejarán de ofrecerlo.',
    );
    expect(lib.eliminarCampoEgreso).toHaveBeenCalledWith("c2");
    expect(lib.listarCamposEgreso).toHaveBeenCalledTimes(2);
  });

  it("si el campo tiene gastos este año, la baja muestra el motivo del servidor (409) y no recarga", async () => {
    sesion(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(lib.eliminarCampoEgreso).mockRejectedValue(
      new ErrorApi("conflicto", 409, "Este campo tiene gastos este año; podrás darlo de baja el próximo año."),
    );
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Gasolina")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este campo tiene gastos este año; podrás darlo de baja el próximo año.",
    );
    expect(lib.listarCamposEgreso).toHaveBeenCalledTimes(1);
  });

  it("cancelar la confirmación no da de baja", async () => {
    sesion(true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PantallaCamposEgreso />);
    const fila = (await screen.findByText("Gasolina")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(lib.eliminarCampoEgreso).not.toHaveBeenCalled();
  });
});
