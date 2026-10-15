import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as promocionesLib from "@/lib/promociones";
import type { Promocion } from "@/lib/promociones";
import * as productosLib from "@/lib/productos";
import * as sucursalesLib from "@/lib/sucursales";
import { FormularioPromocion } from "./formulario-promocion";

vi.mock("@/lib/promociones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/promociones")>();
  return { ...real, crearPromocion: vi.fn(), editarPromocion: vi.fn() };
});
vi.mock("@/lib/productos");
vi.mock("@/lib/sucursales");
vi.mock("@/components/auth/auth-provider");

type Sesion = NonNullable<ReturnType<typeof useAuth>["usuario"]>;
const GENERAL = { sucursal: null } as unknown as Sesion;
const ATADO = { sucursal: { id: "s-tj", codigo: "TJ", nombre: "Tijuana" } } as unknown as Sesion;

function mockAuth(usuario: Sesion) {
  vi.mocked(useAuth).mockReturnValue({
    usuario,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => true,
  });
}

const PRODUCTOS = [
  {
    id: "p-jawa",
    nombre: "Jawa",
    activo: true,
    presentaciones: [
      { id: "pr-600", volumen: "600 ml" },
      { id: "pr-1l", volumen: "1 L" },
    ],
  },
  { id: "p-hor", nombre: "Horchata", activo: true, presentaciones: [{ id: "pr-hor", volumen: "1 L" }] },
];

const EXISTENTE: Promocion = {
  id: "promo1",
  sucursalId: "s-tj",
  sucursalCodigo: "TJ",
  activo: true,
  audiencia: "todos",
  clienteId: null,
  clienteNombre: null,
  compraTipo: "producto",
  compraProductoId: "p-jawa",
  compraPresentacionId: null,
  compraCantidad: 10,
  regaloTipo: "mismo",
  regaloProductoId: null,
  regaloPresentacionId: null,
  regaloCantidad: 1,
  seRepite: true,
  compraNombre: "Jawa",
  regaloNombre: null,
  compraProductoCubierto: "p-jawa",
  texto: "Por cada 10 Jawa, 1 Jawa gratis",
};

const alGuardar = vi.fn();
const alCancelar = vi.fn();
const CONTEXTO_TJ = { tipo: "sucursal", sucursal: "TJ" } as const;

function pintar(props: Partial<React.ComponentProps<typeof FormularioPromocion>> = {}) {
  return render(
    <FormularioPromocion
      promocion={null}
      contexto={CONTEXTO_TJ}
      alGuardar={alGuardar}
      alCancelar={alCancelar}
      {...props}
    />,
  );
}

/** Espera a que lleguen los productos (los desplegables se llenan de forma asíncrona). */
async function esperarProductos() {
  await screen.findByRole("option", { name: "Jawa" });
}

async function armarJawa10(usuario: ReturnType<typeof userEvent.setup>) {
  await esperarProductos();
  await usuario.selectOptions(screen.getByLabelText("Producto que compra"), "p-jawa");
}

describe("FormularioPromocion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(ATADO);
    vi.mocked(productosLib.listarProductos).mockResolvedValue(PRODUCTOS);
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "s-tj", codigo: "TJ", nombre: "Tijuana", activa: true },
      { id: "s-mx", codigo: "MX", nombre: "Mexicali", activa: true },
      { id: "s-xx", codigo: "XX", nombre: "Cerrada", activa: false },
    ]);
    vi.mocked(promocionesLib.crearPromocion).mockResolvedValue([]);
    vi.mocked(promocionesLib.editarPromocion).mockResolvedValue(EXISTENTE);
  });

  it("muestra la frase en vivo", async () => {
    const usuario = userEvent.setup();
    pintar();
    await armarJawa10(usuario);

    expect(screen.getByText("Por cada 10 Jawa, 1 Jawa gratis")).toBeInTheDocument();
    expect(screen.getByLabelText("Todos los clientes")).toBeChecked();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("bloquea Guardar y explica cuando la regla no cuadra", async () => {
    const usuario = userEvent.setup();
    pintar();
    await esperarProductos();
    await usuario.selectOptions(screen.getByLabelText("Qué compra"), "cualquiera");

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(
      screen.getByText(/Si la compra es de cualquier producto, el regalo tiene que ser/),
    ).toBeInTheDocument();
  });

  it("al abrir el alta, lo que falta es una indicación y no un error hasta que se toca algo", async () => {
    const usuario = userEvent.setup();
    pintar();
    await esperarProductos();

    const aviso = screen.getByText("Elige el producto que se compra.");
    expect(aviso).not.toHaveClass("text-destructive");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    await usuario.clear(screen.getByLabelText("Cantidad que regala"));
    await usuario.type(screen.getByLabelText("Cantidad que regala"), "2");

    expect(screen.getByText("Elige el producto que se compra.")).toHaveClass("text-destructive");
  });

  it("comprar 0 solo con prospectos", async () => {
    const usuario = userEvent.setup();
    pintar();
    await armarJawa10(usuario);
    await usuario.clear(screen.getByLabelText("Cantidad que compra"));
    await usuario.type(screen.getByLabelText("Cantidad que compra"), "0");

    expect(screen.getByText(/La cantidad de compra debe ser al menos 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    await usuario.click(screen.getByLabelText("Prospectos, solo en su primera venta"));

    expect(
      screen.getByText("Bienvenida al prospecto: 1 Jawa gratis en su primera venta"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("con Prospectos se oculta 'Se repite por bloques' y se manda seRepite: false", async () => {
    const usuario = userEvent.setup();
    pintar();
    await armarJawa10(usuario);
    expect(screen.getByLabelText("Se repite por bloques")).toBeChecked();

    await usuario.click(screen.getByLabelText("Prospectos, solo en su primera venta"));
    expect(screen.queryByLabelText("Se repite por bloques")).not.toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(promocionesLib.crearPromocion).toHaveBeenCalledWith(
      expect.objectContaining({ audiencia: "prospecto", seRepite: false }),
    );
  });

  it("un General elige sucursal o todas; un usuario atado no ve el selector", async () => {
    mockAuth(GENERAL);
    const usuario = userEvent.setup();
    // Sin sucursal en el selector global: nada preseleccionado, Guardar espera la elección.
    const { unmount } = pintar({ contexto: { tipo: "sucursal", sucursal: null } });
    await armarJawa10(usuario);

    const selector = await screen.findByLabelText("Sucursal");
    expect(screen.getByRole("option", { name: /Todas las sucursales/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "TJ · Tijuana" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Cerrada/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    await usuario.selectOptions(selector, "todas");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(promocionesLib.crearPromocion).toHaveBeenCalledWith(
      expect.objectContaining({ sucursalId: "todas", audiencia: "todos" }),
    );

    unmount();
    mockAuth(ATADO);
    pintar();
    await esperarProductos();
    expect(screen.queryByLabelText("Sucursal")).not.toBeInTheDocument();
  });

  it("desde el cliente la audiencia es fija y manda clienteId", async () => {
    const usuario = userEvent.setup();
    pintar({ contexto: { tipo: "cliente", clienteId: "c1", clienteNombre: "Abarrotes" } });
    await armarJawa10(usuario);

    expect(screen.queryByLabelText("Todos los clientes")).not.toBeInTheDocument();
    expect(screen.getByText("Para Abarrotes")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    const cuerpo = vi.mocked(promocionesLib.crearPromocion).mock.calls[0][0];
    expect(cuerpo).toMatchObject({ audiencia: "cliente", clienteId: "c1", compraProductoId: "p-jawa" });
    expect(cuerpo).not.toHaveProperty("sucursalId");
    expect(alGuardar).toHaveBeenCalled();
  });

  it("editar manda la regla completa y activo", async () => {
    const usuario = userEvent.setup();
    pintar({ promocion: EXISTENTE });
    await esperarProductos();

    await usuario.clear(screen.getByLabelText("Cantidad que compra"));
    await usuario.type(screen.getByLabelText("Cantidad que compra"), "12");
    await usuario.click(screen.getByLabelText("Activa"));
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(promocionesLib.editarPromocion).toHaveBeenCalledWith("promo1", {
      compraTipo: "producto",
      compraProductoId: "p-jawa",
      compraCantidad: 12,
      regaloTipo: "mismo",
      regaloCantidad: 1,
      seRepite: true,
      activo: false,
    });
  });

  it("un error de la API se muestra tal cual", async () => {
    vi.mocked(promocionesLib.crearPromocion).mockRejectedValue(
      new ErrorApi("conflict", 409, "Ya existe una promoción igual en esta sucursal."),
    );
    const usuario = userEvent.setup();
    pintar();
    await armarJawa10(usuario);
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe una promoción igual en esta sucursal.",
    );
    expect(alGuardar).not.toHaveBeenCalled();
  });
});
