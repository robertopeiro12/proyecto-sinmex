import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClienteResumen } from "@/lib/clientes";
import { BuscadorCliente } from "./buscador-cliente";

const cliente = (
  id: string,
  nombre: string,
  m: Partial<ClienteResumen> = {},
): ClienteResumen => ({
  id,
  nombre,
  telefono: "",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
  ...m,
});

const CLIENTES = [
  cliente("c3", "Tienda Lupita"),
  cliente("c1", "Abarrotes Ñoño"),
  cliente("c2", "Mariscos Bucanero"),
  cliente("c4", "Árbol de Café", { tipo: "prospecto" }),
];

function montar(m: Partial<Parameters<typeof BuscadorCliente>[0]> = {}) {
  const onElegir = vi.fn();
  const onQuitar = vi.fn();
  const u = userEvent.setup();
  const r = render(
    <>
      <BuscadorCliente
        clientes={CLIENTES}
        cliente={null}
        onElegir={onElegir}
        onQuitar={onQuitar}
        {...m}
      />
      <button type="button">Afuera</button>
    </>,
  );
  return { u, onElegir, onQuitar, ...r };
}

const nombres = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("BuscadorCliente", () => {
  it("dos buscadores a la vez: cada etiqueta apunta a su propio cuadro", () => {
    const props = {
      clientes: [],
      cliente: null,
      onElegir: () => {},
      onQuitar: () => {},
    };
    const { container } = render(
      <>
        <BuscadorCliente {...props} />
        <BuscadorCliente {...props} />
      </>,
    );
    const etiquetas = Array.from(container.querySelectorAll("label"));
    const cuadros = screen.getAllByLabelText("Cliente");
    expect(etiquetas).toHaveLength(2);
    expect(cuadros).toHaveLength(2);
    expect(cuadros[0].id).not.toBe(cuadros[1].id);
    etiquetas.forEach((e, i) => expect(e.htmlFor).toBe(cuadros[i].id));
  });

  it("al enfocar, antes de escribir, muestra todos los clientes en orden alfabético", async () => {
    const { u } = montar();
    expect(screen.queryByRole("listbox")).toBeNull();
    await u.click(screen.getByRole("combobox", { name: "Cliente" }));
    expect(screen.getByRole("combobox", { name: "Cliente" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(nombres()).toEqual([
      "Abarrotes Ñoño · TJ",
      "Árbol de Café · TJ · Prospecto",
      "Mariscos Bucanero · TJ",
      "Tienda Lupita · TJ",
    ]);
  });

  it("al escribir filtra, sin acentos ni mayúsculas", async () => {
    const { u } = montar();
    await u.type(screen.getByRole("combobox", { name: "Cliente" }), "ARB");
    expect(nombres()).toEqual(["Árbol de Café · TJ · Prospecto"]);
    await u.clear(screen.getByRole("combobox", { name: "Cliente" }));
    await u.type(screen.getByRole("combobox", { name: "Cliente" }), "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      screen.getByText("Ningún cliente con ese nombre."),
    ).toBeInTheDocument();
  });

  it("la lista flota: no empuja lo de abajo", async () => {
    const { u } = montar();
    await u.click(screen.getByRole("combobox", { name: "Cliente" }));
    expect(screen.getByRole("listbox").style.position).toBe("fixed");
  });

  it("la lista se monta en el body, fuera del contenedor (una ventana no la recorta)", async () => {
    const { u, container } = montar();
    await u.click(screen.getByRole("combobox", { name: "Cliente" }));
    const lista = screen.getByRole("listbox");
    expect(container.contains(lista)).toBe(false);
    expect(lista.parentElement).toBe(document.body);
    expect(lista.style.position).toBe("fixed");
  });

  it("flechas mueven, Enter elige y Escape cierra", async () => {
    const { u, onElegir } = montar();
    const cuadro = screen.getByRole("combobox", { name: "Cliente" });
    await u.click(cuadro);
    await u.keyboard("{ArrowDown}{ArrowDown}");
    const activa = screen.getByRole("option", { name: /Árbol de Café/ });
    expect(activa).toHaveAttribute("aria-selected", "true");
    expect(cuadro).toHaveAttribute("aria-activedescendant", activa.id);
    await u.keyboard("{ArrowUp}");
    expect(
      screen.getByRole("option", { name: /Abarrotes Ñoño/ }),
    ).toHaveAttribute("aria-selected", "true");
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onElegir).not.toHaveBeenCalled();

    await u.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await u.type(cuadro, "maris");
    await u.keyboard("{Enter}");
    expect(onElegir).toHaveBeenCalledWith(CLIENTES[2]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clic en un cliente lo elige; clic fuera cierra sin elegir", async () => {
    const { u, onElegir } = montar();
    await u.click(screen.getByRole("combobox", { name: "Cliente" }));
    await u.click(screen.getByRole("button", { name: "Afuera" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    await u.click(screen.getByRole("combobox", { name: "Cliente" }));
    await u.click(screen.getByRole("option", { name: /Tienda Lupita/ }));
    expect(onElegir).toHaveBeenCalledWith(CLIENTES[0]);
  });

  it("ya elegido: el nombre en una línea con elipsis y el botón para quitarlo", async () => {
    const { u, onQuitar } = montar({
      cliente: CLIENTES[2],
      etiquetaQuitar: "Quitar",
    });
    expect(screen.getByText("Mariscos Bucanero · TJ")).toHaveClass("truncate");
    await u.click(screen.getByRole("button", { name: "Quitar" }));
    expect(onQuitar).toHaveBeenCalled();
  });

  it("variante campo: sin etiqueta visible, el elegido dentro del campo con ✕", async () => {
    const { u, onQuitar } = montar({
      cliente: CLIENTES[2],
      variante: "campo",
      etiquetaQuitar: "Quitar cliente",
    });
    const nombre = screen.getByText("Mariscos Bucanero");
    expect(nombre).toHaveClass("truncate");
    expect(screen.getByText("Cliente")).toHaveClass("sr-only");
    await u.click(screen.getByRole("button", { name: "Quitar cliente" }));
    expect(onQuitar).toHaveBeenCalled();
  });
});
