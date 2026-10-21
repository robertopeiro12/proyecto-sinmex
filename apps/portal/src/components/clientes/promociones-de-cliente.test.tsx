import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as promocionesLib from "@/lib/promociones";
import type { Promocion } from "@/lib/promociones";
import { PromocionesDeCliente } from "./promociones-de-cliente";

vi.mock("@/lib/promociones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/promociones")>();
  return { ...real, listarPromociones: vi.fn(), editarPromocion: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");
// El formulario embebido tiene sus propias pruebas; aquí solo importa con qué contexto se monta.
vi.mock("@/components/promociones/formulario-promocion", () => ({
  FormularioPromocion: (props: { contexto: { tipo: string }; alGuardar: () => void }) => (
    <div>
      <p>Formulario de promoción ({props.contexto.tipo})</p>
      <button type="button" onClick={props.alGuardar}>
        Guardar simulado
      </button>
    </div>
  ),
}));

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const PROPIA: Promocion = {
  id: "p1",
  sucursalId: "s-tj",
  sucursalCodigo: "TJ",
  activo: true,
  audiencia: "cliente",
  clienteId: "c1",
  clienteNombre: "Abarrotes Lupita",
  compraTipo: "producto",
  compraProductoId: "p-jawa",
  compraPresentacionId: null,
  compraCantidad: 20,
  regaloTipo: "mismo",
  regaloProductoId: null,
  regaloPresentacionId: null,
  regaloCantidad: 1,
  seRepite: true,
  compraNombre: "Jawa",
  regaloNombre: null,
  compraProductoCubierto: "p-jawa",
  texto: "Por cada 20 Jawa, 1 Jawa gratis",
};
const GENERAL: Promocion = {
  ...PROPIA,
  id: "g1",
  audiencia: "todos",
  clienteId: null,
  clienteNombre: null,
  compraCantidad: 10,
  texto: "Por cada 10 Jawa, 1 Jawa gratis",
  desplazada: true,
};

describe("PromocionesDeCliente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(promocionesLib.listarPromociones).mockResolvedValue([PROPIA, GENERAL]);
  });

  it("sin promocion.gestionar no se pinta nada", () => {
    mockAuth(() => false);
    const { container } = render(
      <PromocionesDeCliente clienteId="c1" clienteNombre="Abarrotes Lupita" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(promocionesLib.listarPromociones).not.toHaveBeenCalled();
  });

  it("lista las propias con Editar y Desactivar, y las generales atenuadas con el aviso de desplazada", async () => {
    mockAuth(() => true);
    render(<PromocionesDeCliente clienteId="c1" clienteNombre="Abarrotes Lupita" />);

    expect(await screen.findByText("Por cada 20 Jawa, 1 Jawa gratis")).toBeInTheDocument();
    expect(promocionesLib.listarPromociones).toHaveBeenCalledWith({ clienteId: "c1" });
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();

    const general = screen.getByText(/Por cada 10 Jawa, 1 Jawa gratis/);
    expect(general).toHaveTextContent("(desplazada por una propia)");
    expect(general.closest("li")).toHaveClass("opacity-60");
    // Las generales se administran en la zona de Promociones, no desde el cliente.
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(1);
  });

  it("la bienvenida de un prospecto se lista con las generales, sin Editar", async () => {
    mockAuth(() => true);
    const BIENVENIDA: Promocion = {
      ...GENERAL,
      id: "b1",
      audiencia: "prospecto",
      compraCantidad: 0,
      seRepite: false,
      texto: "Bienvenida al prospecto: 1 Jawa gratis en su primera venta",
      desplazada: false,
    };
    vi.mocked(promocionesLib.listarPromociones).mockResolvedValue([BIENVENIDA]);
    render(<PromocionesDeCliente clienteId="c1" clienteNombre="Abarrotes Lupita" />);

    const fila = await screen.findByText("Bienvenida al prospecto: 1 Jawa gratis en su primera venta");
    expect(fila.closest("li")).toHaveClass("opacity-60");
    expect(screen.getByText("Generales de su sucursal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("Desactivar llama a editarPromocion con la regla completa y activo: false, y recarga", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    vi.mocked(promocionesLib.editarPromocion).mockResolvedValue({ ...PROPIA, activo: false });
    render(<PromocionesDeCliente clienteId="c1" clienteNombre="Abarrotes Lupita" />);
    await screen.findByText("Por cada 20 Jawa, 1 Jawa gratis");

    await usuario.click(screen.getByRole("button", { name: "Desactivar" }));

    await waitFor(() =>
      expect(promocionesLib.editarPromocion).toHaveBeenCalledWith("p1", {
        compraTipo: "producto",
        compraProductoId: "p-jawa",
        compraPresentacionId: undefined,
        compraCantidad: 20,
        regaloTipo: "mismo",
        regaloProductoId: undefined,
        regaloPresentacionId: undefined,
        regaloCantidad: 1,
        seRepite: true,
        activo: false,
      }),
    );
    await waitFor(() => expect(promocionesLib.listarPromociones).toHaveBeenCalledTimes(2));
  });

  it("Nueva promoción para este cliente abre el formulario con contexto de cliente y recarga al guardar", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    render(<PromocionesDeCliente clienteId="c1" clienteNombre="Abarrotes Lupita" />);
    await screen.findByText("Por cada 20 Jawa, 1 Jawa gratis");

    await usuario.click(screen.getByRole("button", { name: "Nueva promoción para este cliente" }));
    expect(screen.getByText("Formulario de promoción (cliente)")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Guardar simulado" }));
    await waitFor(() => expect(promocionesLib.listarPromociones).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Formulario de promoción/)).not.toBeInTheDocument();
  });

  it("el formulario embebido lleva su título: Nueva o Editar promoción", async () => {
    const usuario = userEvent.setup();
    mockAuth(() => true);
    render(<PromocionesDeCliente clienteId="c1" clienteNombre="Abarrotes Lupita" />);
    await screen.findByText("Por cada 20 Jawa, 1 Jawa gratis");

    await usuario.click(screen.getByRole("button", { name: "Nueva promoción para este cliente" }));
    expect(screen.getByRole("heading", { level: 4, name: "Nueva promoción" })).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("heading", { level: 4, name: "Editar promoción" })).toBeInTheDocument();
  });
});
