import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import { PantallaCatalogo } from "./pantalla-catalogo";

// AuthProvider se mockea como en pantalla-sucursales.test.tsx: su propia carga
// de sesion (GET /auth/me) es un problema aparte de esta pantalla.
vi.mock("@/components/auth/auth-provider");

interface Item {
  id: string;
  nombre: string;
}

const JAMAICA: Item = { id: "1", nombre: "Jamaica" };
const HORCHATA: Item = { id: "2", nombre: "Horchata" };

function mockAuth(puede: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => puede,
  });
}

/** El formulario de prueba: un campo "Nombre" y Guardar/Cancelar. `guardar` decide cuándo termina. */
function FormularioPrueba({
  item,
  alGuardar,
  alCancelar,
  guardar,
}: {
  item: Item | null;
  alGuardar: () => void;
  alCancelar: () => void;
  guardar: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState(item?.nombre ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void guardar().then(alGuardar);
      }}
    >
      <label>
        Nombre
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>
      <button type="submit">Guardar</button>
      <button type="button" onClick={alCancelar}>
        Cancelar
      </button>
    </form>
  );
}

function renderizar({
  cargar = vi.fn().mockResolvedValue([JAMAICA, HORCHATA]),
  guardar = () => Promise.resolve(),
  ...props
}: {
  cargar?: () => Promise<Item[]>;
  guardar?: () => Promise<void>;
  formularioEn?: "ventana" | "pantalla";
  baja?: Parameters<typeof PantallaCatalogo<Item>>[0]["baja"];
} = {}) {
  render(
    <PantallaCatalogo<Item>
      titulo="Sabores"
      descripcion="Los sabores que se venden."
      permiso="sabor.gestionar"
      etiquetaAlta="Nuevo sabor"
      vacio="No hay sabores."
      mensajeError="No se pudieron cargar los sabores."
      cargar={cargar}
      columnas={[{ encabezado: "Nombre", celda: (i) => i.nombre }]}
      tituloFormulario={(i) => (i ? `Editar ${i.nombre}` : "Nuevo sabor")}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioPrueba item={item} alGuardar={alGuardar} alCancelar={alCancelar} guardar={guardar} />
      )}
      {...props}
    />,
  );
  return { cargar };
}

const filaDe = (texto: string) => screen.getByText(texto).closest("tr")!;

function bajaDePrueba(ejecutar = vi.fn().mockResolvedValue(undefined)) {
  return {
    ejecutar,
    baja: {
      confirmar: (i: Item) => ({
        titulo: `¿Dar de baja ${i.nombre}?`,
        descripcion: "Deja de salir en la app.",
        confirmar: "Dar de baja",
      }),
      ejecutar,
      mensajeError: "No se pudo dar de baja.",
    },
  };
}

describe("PantallaCatalogo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("muestra título, descripción y la tabla", async () => {
    renderizar();
    expect(screen.getByRole("heading", { level: 1, name: "Sabores" })).toBeInTheDocument();
    expect(screen.getByText("Los sabores que se venden.")).toBeInTheDocument();
    expect(await screen.findByText("Jamaica")).toBeInTheDocument();
    // +1 por la fila de encabezados.
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("sin permiso no hay alta, ni Editar, ni baja", async () => {
    mockAuth(false);
    renderizar(bajaDePrueba());
    await screen.findByText("Jamaica");
    expect(screen.queryByRole("button", { name: "Nuevo sabor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dar de baja" })).not.toBeInTheDocument();
  });

  it("Nuevo abre la ventana con el título del formulario y Guardar la cierra y recarga", async () => {
    const usuario = userEvent.setup();
    const { cargar } = renderizar();
    await screen.findByText("Jamaica");

    await usuario.click(screen.getByRole("button", { name: "Nuevo sabor" }));
    const ventana = screen.getByRole("dialog", { name: "Nuevo sabor" });
    expect(within(ventana).getByLabelText("Nombre")).toHaveValue("");

    await usuario.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(cargar).toHaveBeenCalledTimes(2));
  });

  it("Cancelar y Esc cierran sin recargar", async () => {
    const usuario = userEvent.setup();
    const { cargar } = renderizar();
    await screen.findByText("Jamaica");

    await usuario.click(screen.getByRole("button", { name: "Nuevo sabor" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await usuario.click(within(filaDe("Jamaica")).getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("dialog", { name: "Editar Jamaica" })).toBeInTheDocument();
    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(cargar).toHaveBeenCalledTimes(1);
  });

  // Punto a revisar 2: el `key` por item (T-09).
  it("cerrar A y abrir B muestra los valores de B", async () => {
    const usuario = userEvent.setup();
    renderizar();
    await screen.findByText("Jamaica");

    await usuario.click(within(filaDe("Jamaica")).getByRole("button", { name: "Editar" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Nombre")).toHaveValue("Jamaica");
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await usuario.click(within(filaDe("Horchata")).getByRole("button", { name: "Editar" }));
    const ventana = screen.getByRole("dialog", { name: "Editar Horchata" });
    expect(within(ventana).getByLabelText("Nombre")).toHaveValue("Horchata");
  });

  // Punto a revisar 1.
  it("Esc a media petición cierra y la respuesta tardía no rompe", async () => {
    const usuario = userEvent.setup();
    const errores = vi.spyOn(console, "error");
    let terminar!: () => void;
    const guardar = () => new Promise<void>((r) => (terminar = r));
    const { cargar } = renderizar({ guardar });
    await screen.findByText("Jamaica");

    await usuario.click(screen.getByRole("button", { name: "Nuevo sabor" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar" }));
    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    terminar();
    await waitFor(() => expect(cargar).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Jamaica")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(errores).not.toHaveBeenCalled();
  });

  it("la respuesta tardía de A no cierra la ventana que se abrió después", async () => {
    const usuario = userEvent.setup();
    let terminar!: () => void;
    const guardar = () => new Promise<void>((r) => (terminar = r));
    const { cargar } = renderizar({ guardar });
    await screen.findByText("Jamaica");

    await usuario.click(within(filaDe("Jamaica")).getByRole("button", { name: "Editar" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar" }));
    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await usuario.click(screen.getByRole("button", { name: "Nuevo sabor" }));

    terminar();
    await waitFor(() => expect(cargar).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("dialog", { name: "Nuevo sabor" })).toBeInTheDocument();
  });

  it("modo pantalla cambia la lista por el formulario y ← Volver regresa", async () => {
    const usuario = userEvent.setup();
    renderizar({ formularioEn: "pantalla" });
    await screen.findByText("Jamaica");

    await usuario.click(screen.getByRole("button", { name: "Nuevo sabor" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "← Volver a sabores" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("baja confirmada ejecuta y recarga", async () => {
    const usuario = userEvent.setup();
    const { ejecutar, baja } = bajaDePrueba();
    const { cargar } = renderizar({ baja });
    await screen.findByText("Jamaica");

    await usuario.click(within(filaDe("Jamaica")).getByRole("button", { name: "Dar de baja" }));
    const pregunta = screen.getByRole("alertdialog", { name: "¿Dar de baja Jamaica?" });
    await usuario.click(within(pregunta).getByRole("button", { name: "Dar de baja" }));

    await waitFor(() => expect(cargar).toHaveBeenCalledTimes(2));
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(ejecutar).toHaveBeenCalledWith(JAMAICA);
  });

  it("baja cancelada no ejecuta", async () => {
    const usuario = userEvent.setup();
    const { ejecutar, baja } = bajaDePrueba();
    const { cargar } = renderizar({ baja });
    await screen.findByText("Jamaica");

    await usuario.click(within(filaDe("Jamaica")).getByRole("button", { name: "Dar de baja" }));
    await usuario.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    expect(ejecutar).not.toHaveBeenCalled();
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  // Punto a revisar 3: el 409 de Campos de egreso.
  it("baja rechazada muestra el mensaje del servidor y la fila sigue", async () => {
    const usuario = userEvent.setup();
    const { baja } = bajaDePrueba(
      vi.fn().mockRejectedValue(new ErrorApi("La peticion fallo", 409, "Podrás darlo de baja el próximo año.")),
    );
    renderizar({ baja });
    await screen.findByText("Jamaica");

    await usuario.click(within(filaDe("Jamaica")).getByRole("button", { name: "Dar de baja" }));
    await usuario.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Dar de baja" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Podrás darlo de baja el próximo año.");
    expect(screen.getByText("Jamaica")).toBeInTheDocument();
    expect(within(filaDe("Jamaica")).getByRole("button", { name: "Dar de baja" })).toBeEnabled();
  });

  it("abrir un formulario quita el aviso de una baja fallida", async () => {
    const usuario = userEvent.setup();
    const { baja } = bajaDePrueba(
      vi.fn().mockRejectedValue(new ErrorApi("La peticion fallo", 409, "Podrás darlo de baja el próximo año.")),
    );
    renderizar({ baja });
    await screen.findByText("Jamaica");

    await usuario.click(within(filaDe("Jamaica")).getByRole("button", { name: "Dar de baja" }));
    await usuario.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Dar de baja" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Nuevo sabor" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
