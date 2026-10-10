import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as clientesLib from "@/lib/clientes";
import { FotoProspecto } from "./foto-prospecto";

// Se mockea la capa de red (lib/*.ts), no `fetch`: mismo límite que el resto de
// las pruebas del portal (ver pantalla-clientes.test.tsx).
vi.mock("@/lib/clientes");

const descargarFotoCliente = vi.mocked(clientesLib.descargarFotoCliente);

/**
 * jsdom no implementa `URL.createObjectURL` ni `revokeObjectURL` (no tiene
 * almacén de blobs). Sin estos stubs, la prueba moriría con un TypeError que no
 * tiene nada que ver con lo que se está probando.
 */
const revocadas: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  revocadas.length = 0;
  URL.createObjectURL = vi.fn(() => "blob:foto-de-prueba");
  URL.revokeObjectURL = vi.fn((url: string) => {
    revocadas.push(url);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PROPS = {
  clienteId: "cli-1",
  nombre: "Tacos Aarón",
  fotoSubidaEn: "2026-09-18T20:15:00.000Z",
};

describe("FotoProspecto", () => {
  /**
   * La regla que importa de esta pantalla: un prospecto sin foto **no dibuja
   * hueco**. La foto es opcional, la mayoría no la tendrá, y un marco vacío por
   * cada uno daría a entender que falta un dato que nadie pidió.
   */
  it("un prospecto sin foto no dibuja nada, ni pide la imagen", () => {
    const { container } = render(
      <FotoProspecto {...PROPS} tieneFoto={false} fotoSubidaEn={null} />,
    );

    expect(container).toBeEmptyDOMElement();
    // Y no gasta una petición en preguntar por algo que ya sabe que no existe.
    expect(descargarFotoCliente).not.toHaveBeenCalled();
  });

  it("un prospecto con foto muestra la miniatura", async () => {
    descargarFotoCliente.mockResolvedValue(new Blob(["bytes"]));

    render(<FotoProspecto {...PROPS} tieneFoto />);

    const imagen = await screen.findByAltText("Foto del lugar de Tacos Aarón");
    expect(imagen).toHaveAttribute("src", "blob:foto-de-prueba");
    expect(descargarFotoCliente).toHaveBeenCalledWith("cli-1");
  });

  it("la miniatura se amplía y se cierra", async () => {
    descargarFotoCliente.mockResolvedValue(new Blob(["bytes"]));
    const usuario = userEvent.setup();

    render(<FotoProspecto {...PROPS} tieneFoto />);
    await screen.findByAltText("Foto del lugar de Tacos Aarón");

    // Antes de ampliar no hay diálogo: la vista grande no existe en el DOM.
    expect(screen.queryByRole("dialog")).toBeNull();

    await usuario.click(
      screen.getByRole("button", { name: "Ampliar la foto de Tacos Aarón" }),
    );
    expect(screen.getByRole("dialog", { name: "Foto de Tacos Aarón" })).toBeTruthy();

    await usuario.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  /**
   * Un fallo de la foto **no** es un fallo del prospecto. Se avisa en una línea
   * discreta y nada más: ni un `role="alert"`, ni un mensaje de error, porque no
   * hay nada que el administrador tenga que arreglar y el resto de la ficha
   * sigue siendo válida.
   */
  it("si la foto no baja, lo dice sin romper el resto", async () => {
    descargarFotoCliente.mockRejectedValue(new Error("404"));

    render(<FotoProspecto {...PROPS} tieneFoto />);

    expect(
      await screen.findByText("No se pudo cargar la foto de este prospecto."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /** La URL de objeto se revoca al desmontar, o el Blob se queda en memoria. */
  it("revoca la URL de objeto al desmontar", async () => {
    descargarFotoCliente.mockResolvedValue(new Blob(["bytes"]));

    const { unmount } = render(<FotoProspecto {...PROPS} tieneFoto />);
    await screen.findByAltText("Foto del lugar de Tacos Aarón");

    unmount();
    expect(revocadas).toEqual(["blob:foto-de-prueba"]);
  });
});
