import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as ventasLib from "@/lib/ventas";
import type { VentaDetalle } from "@/lib/ventas";
import { DetalleVenta } from "./detalle-venta";

vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, eliminarVenta: vi.fn(), marcarCuentaPerdida: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const eliminarVenta = vi.mocked(ventasLib.eliminarVenta);
const marcarCuentaPerdida = vi.mocked(ventasLib.marcarCuentaPerdida);

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

const VENTA: VentaDetalle = {
  id: "v1",
  folio: "TJ240304OF01",
  fecha: "2024-03-04",
  clienteId: "c1",
  cliente: "Abarrotes Lupita",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  vendedorId: null,
  repartidor: null,
  numNota: "1234",
  contadoCredito: "credito",
  factura: "N/A",
  comentarios: "Entregar temprano",
  montoCentavos: 27000,
  status: "abonado",
  origen: "portal",
  saldoCentavos: 17000,
  lineas: [
    {
      presentacionId: "p1",
      producto: "Horchata",
      volumen: "1 L",
      cantidad: 24,
      cantidadPromocion: 2,
      precioCentavos: 1000,
      subtotalCentavos: 24000,
    },
  ],
  cobros: [{ id: "a1", fechaPago: "2024-03-05", metodoPago: "efectivo", montoCentavos: 10000, origen: "cobro" }],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: true,
};

function renderizar(venta: VentaDetalle = VENTA) {
  const props = { onVolver: vi.fn(), onEditar: vi.fn(), onCambiada: vi.fn(), onEliminada: vi.fn() };
  render(<DetalleVenta venta={venta} {...props} />);
  return { usuario: userEvent.setup(), ...props };
}

describe("DetalleVenta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockAuth(() => true);
  });

  it("muestra cabecera, líneas y cobros; sin vendedor es Oficina", () => {
    renderizar();
    expect(screen.getByText("Venta TJ240304OF01")).toBeInTheDocument();
    expect(screen.getByText("Oficina")).toBeInTheDocument();
    expect(screen.getByText("Abonado")).toBeInTheDocument();
    expect(screen.getByText("Entregar temprano")).toBeInTheDocument();
    expect(screen.getByText("Horchata 1 L")).toBeInTheDocument();
    expect(screen.getByText("$240.00")).toBeInTheDocument();
    expect(screen.getByText("$170.00")).toBeInTheDocument();
    expect(screen.getByText("Cobranza")).toBeInTheDocument();
  });

  it("con permiso, editable y por cobrar: Editar, Eliminar y Marcar como cuenta perdida", () => {
    renderizar();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como cuenta perdida" })).toBeInTheDocument();
  });

  it("no editable: sin Editar ni Eliminar, con el motivo", () => {
    renderizar({
      ...VENTA,
      editable: false,
      motivoNoEditable:
        "Esta venta tiene cobros registrados: no se puede editar ni eliminar. Para quitar un cobro, ver Peticiones.",
    });
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.getByText(/no se puede editar ni eliminar\. Para quitar un cobro, ver Peticiones\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como cuenta perdida" })).toBeInTheDocument();
  });

  it("sin el permiso venta.editar_eliminar: solo Volver", () => {
    mockAuth(() => false);
    renderizar();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como cuenta perdida" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("Editar avisa al padre", async () => {
    const { usuario, onEditar } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    expect(onEditar).toHaveBeenCalledTimes(1);
  });

  it("Eliminar pide confirmación y, si se cancela, no hace nada", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(confirmar).toHaveBeenCalledWith("¿Eliminar la venta TJ240304OF01 (nota 1234)? No se puede deshacer.");
    expect(eliminarVenta).not.toHaveBeenCalled();
    expect(onEliminada).not.toHaveBeenCalled();
  });

  // Review Focus 5
  it("Eliminar confirmado llama una sola vez aunque se pulse dos veces, y avisa al terminar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let terminar!: (v: { id: string }) => void;
    eliminarVenta.mockReturnValue(
      new Promise<{ id: string }>((r) => {
        terminar = r;
      }),
    );
    const { usuario, onEliminada } = renderizar();
    const boton = screen.getByRole("button", { name: "Eliminar" });
    await usuario.click(boton);
    await usuario.click(boton);
    expect(eliminarVenta).toHaveBeenCalledTimes(1);
    expect(eliminarVenta).toHaveBeenCalledWith("v1");
    terminar({ id: "v1" });
    await vi.waitFor(() => expect(onEliminada).toHaveBeenCalledTimes(1));
  });

  it("Marcar como cuenta perdida confirma y entrega la venta actualizada", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    const actualizada = { ...VENTA, status: "cuenta_perdida" as const, editable: false, puedeMarcarPerdida: false };
    marcarCuentaPerdida.mockResolvedValue(actualizada);
    const { usuario, onCambiada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Marcar como cuenta perdida" }));
    expect(confirmar).toHaveBeenCalledWith("La venta TJ240304OF01 dejará de cobrarse. ¿Continuar?");
    await vi.waitFor(() => expect(onCambiada).toHaveBeenCalledWith(actualizada));
  });

  it("muestra el mensaje del servidor", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    eliminarVenta.mockRejectedValue(new ErrorApi("fallo", 409, "Tiene cobros registrados: no se puede eliminar."));
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tiene cobros registrados: no se puede eliminar.");
    expect(onEliminada).not.toHaveBeenCalled();
  });
});
