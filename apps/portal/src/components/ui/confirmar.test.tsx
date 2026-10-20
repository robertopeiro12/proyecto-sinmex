import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useConfirmar, type OpcionesConfirmar } from "./confirmar";

const ELIMINAR: OpcionesConfirmar = {
  titulo: "¿Eliminar la venta TJ261006AP05?",
  descripcion: "No se puede deshacer.",
  confirmar: "Eliminar venta",
};

function Prueba({ alResponder }: { alResponder: (si: boolean) => void }) {
  const { confirmar, ventana } = useConfirmar();
  return (
    <div>
      <button type="button" onClick={() => void confirmar(ELIMINAR).then(alResponder)}>
        Eliminar
      </button>
      <button
        type="button"
        onClick={() =>
          void confirmar({ titulo: "¿Marcar como cuenta perdida?", descripcion: "La venta dejará de cobrarse.", confirmar: "Marcar como perdida", tono: "normal" }).then(alResponder)
        }
      >
        Otra pregunta
      </button>
      {ventana}
    </div>
  );
}

describe("useConfirmar", () => {
  it("muestra título y qué pasa, y contesta sí con el botón del verbo exacto", async () => {
    const usuario = userEvent.setup();
    const alResponder = vi.fn();
    render(<Prueba alResponder={alResponder} />);
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    const ventana = screen.getByRole("alertdialog", { name: "¿Eliminar la venta TJ261006AP05?" });
    expect(ventana).toHaveAccessibleDescription("No se puede deshacer.");
    await usuario.click(screen.getByRole("button", { name: "Eliminar venta" }));
    await waitFor(() => expect(alResponder).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Cancelar contesta no", async () => {
    const usuario = userEvent.setup();
    const alResponder = vi.fn();
    render(<Prueba alResponder={alResponder} />);
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(alResponder).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Escape contesta no", async () => {
    const usuario = userEvent.setup();
    const alResponder = vi.fn();
    render(<Prueba alResponder={alResponder} />);
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(alResponder).toHaveBeenCalledWith(false));
  });

  it("Review Focus 4: doble clic en confirmar contesta una sola vez", async () => {
    const usuario = userEvent.setup();
    const alResponder = vi.fn();
    render(<Prueba alResponder={alResponder} />);
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    // Dos clics seguidos sobre el mismo botón: el primero cierra la ventana, el segundo no hace nada.
    const confirmarBoton = screen.getByRole("button", { name: "Eliminar venta" });
    fireEvent.click(confirmarBoton);
    fireEvent.click(confirmarBoton);
    await waitFor(() => expect(alResponder).toHaveBeenCalledTimes(1));
    expect(alResponder).toHaveBeenCalledWith(true);
  });

  it("Review Focus 4: una pregunta nueva contesta no a la que seguía abierta", async () => {
    const alResponder = vi.fn();
    function DosPreguntas() {
      const { confirmar, ventana } = useConfirmar();
      const [hecho, setHecho] = useState(false);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              void confirmar(ELIMINAR).then(alResponder);
              void confirmar({ ...ELIMINAR, titulo: "¿Otra?" }).then(alResponder);
              setHecho(true);
            }}
          >
            Dos
          </button>
          {hecho && <span>hecho</span>}
          {ventana}
        </div>
      );
    }
    const usuario = userEvent.setup();
    render(<DosPreguntas />);
    await usuario.click(screen.getByRole("button", { name: "Dos" }));
    await waitFor(() => expect(alResponder).toHaveBeenCalledWith(false));
    expect(screen.getByRole("alertdialog", { name: "¿Otra?" })).toBeInTheDocument();
  });

  it("tono normal no pinta el botón en rojo", async () => {
    const usuario = userEvent.setup();
    render(<Prueba alResponder={vi.fn()} />);
    await usuario.click(screen.getByRole("button", { name: "Otra pregunta" }));
    expect(screen.getByRole("button", { name: "Marcar como perdida" })).not.toHaveClass("bg-destructive");
  });
});
