import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as ventasLib from "@/lib/ventas";
import type { PresentacionDeCatalogo, VentaDetalle } from "@/lib/ventas";
import { FormularioEditarVenta } from "./formulario-editar-venta";

vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    obtenerCatalogoVenta: vi.fn(),
    listarRepartidores: vi.fn(),
    editarVenta: vi.fn(),
  };
});

const obtenerCatalogoVenta = vi.mocked(ventasLib.obtenerCatalogoVenta);
const listarRepartidores = vi.mocked(ventasLib.listarRepartidores);
const editarVenta = vi.mocked(ventasLib.editarVenta);

const CATALOGO: PresentacionDeCatalogo[] = [
  { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 },
  { presentacionId: "p2", producto: "Jamaica", volumen: "500 ml", precioCentavos: 600 },
  { presentacionId: "p3", producto: "Tamarindo", volumen: "2 L", precioCentavos: null },
];

const VENTA: VentaDetalle = {
  id: "v1",
  folio: "TJ240304AP01",
  fecha: "2024-03-04",
  clienteId: "c1",
  cliente: "Abarrotes Lupita",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  vendedorId: "v-ana",
  repartidor: "Ana Pérez",
  numNota: "1234",
  contadoCredito: "credito",
  factura: "N/A",
  comentarios: null,
  montoCentavos: 21600,
  status: "pendiente",
  origen: "portal",
  saldoCentavos: 21600,
  lineas: [
    {
      presentacionId: "p1",
      producto: "Horchata",
      volumen: "1 L",
      cantidad: 24,
      cantidadPromocion: 2,
      precioCentavos: 900,
      subtotalCentavos: 21600,
    },
  ],
  cobros: [],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: true,
};

async function prepararFormulario(venta: VentaDetalle = VENTA) {
  const usuario = userEvent.setup();
  const onGuardada = vi.fn();
  const onCancelar = vi.fn();
  render(<FormularioEditarVenta venta={venta} onGuardada={onGuardada} onCancelar={onCancelar} />);
  await screen.findByLabelText("Cantidad de Jamaica 500 ml");
  return { usuario, onGuardada, onCancelar };
}

describe("FormularioEditarVenta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtenerCatalogoVenta.mockResolvedValue(CATALOGO);
    listarRepartidores.mockResolvedValue([{ id: "v-ana", nombre: "Ana Pérez" }]);
    editarVenta.mockResolvedValue({ ...VENTA, montoCentavos: 9000 });
  });

  it("cliente y fecha fijos; la línea guardada muestra su precio y lo nuevo el de la lista a la fecha", async () => {
    await prepararFormulario();
    expect(obtenerCatalogoVenta).toHaveBeenCalledWith("c1", "2024-03-04");
    expect(listarRepartidores).toHaveBeenCalledWith("suc-tj");
    expect(screen.queryByLabelText("Fecha")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cliente")).not.toBeInTheDocument();
    expect(screen.getByText("2024-03-04")).toBeInTheDocument();
    expect(screen.getByText("Abarrotes Lupita · TJ")).toBeInTheDocument();

    expect(screen.getByLabelText("Cantidad de Horchata 1 L")).toHaveValue(24);
    const filaHorchata = screen.getByLabelText("Cantidad de Horchata 1 L").closest("tr");
    expect(within(filaHorchata as HTMLElement).getByText("$9.00")).toBeInTheDocument();
    const filaJamaica = screen.getByLabelText("Cantidad de Jamaica 500 ml").closest("tr");
    expect(within(filaJamaica as HTMLElement).getByText("$6.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Cantidad de Tamarindo 2 L")).toBeDisabled();
    expect(screen.getByText("Total: $216.00")).toBeInTheDocument();
  });

  it("manda el estado completo sin precios y entrega la venta actualizada", async () => {
    const { usuario, onGuardada } = await prepararFormulario();
    const cantidad = screen.getByLabelText("Cantidad de Horchata 1 L");
    await usuario.clear(cantidad);
    await usuario.type(cantidad, "10");
    await usuario.type(screen.getByLabelText("Cantidad de Jamaica 500 ml"), "3");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));

    expect(editarVenta).toHaveBeenCalledWith("v1", {
      vendedorId: "v-ana",
      numNota: "1234",
      contadoCredito: "credito",
      factura: "N/A",
      lineas: [
        { presentacionId: "p1", cantidad: 10, cantidadPromocion: 2 },
        { presentacionId: "p2", cantidad: 3, cantidadPromocion: 0 },
      ],
    });
    expect(onGuardada).toHaveBeenCalledWith({ ...VENTA, montoCentavos: 9000 });
  });

  it("una venta de la tablet no ofrece Oficina", async () => {
    await prepararFormulario({ ...VENTA, origen: "app" });
    expect(screen.queryByRole("option", { name: "Oficina" })).not.toBeInTheDocument();
  });

  it("una venta del portal sí ofrece Oficina, y elegirla manda vendedorId null", async () => {
    const { usuario } = await prepararFormulario();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(editarVenta.mock.calls[0][1].vendedorId).toBeNull();
  });

  // Review Focus 2
  it("conserva como opción al repartidor actual aunque ya no esté activo", async () => {
    listarRepartidores.mockResolvedValue([{ id: "v-luis", nombre: "Luis Ruiz" }]);
    const { usuario } = await prepararFormulario();
    expect(screen.getByLabelText("Repartidor")).toHaveValue("v-ana");
    expect(await screen.findByRole("option", { name: "Ana Pérez (inactivo)" })).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(editarVenta.mock.calls[0][1].vendedorId).toBe("v-ana");
  });

  it("una venta de contado propone el método de su cobro", async () => {
    const { usuario } = await prepararFormulario({
      ...VENTA,
      contadoCredito: "contado",
      cobros: [
        { id: "a1", fechaPago: "2024-03-04", metodoPago: "efectivo", montoCentavos: 21600, origen: "venta_contado" },
      ],
    });
    expect(screen.getByLabelText("Método de pago")).toHaveValue("efectivo");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(editarVenta.mock.calls[0][1]).toMatchObject({ contadoCredito: "contado", metodoPago: "efectivo" });
  });

  it("muestra el mensaje del servidor", async () => {
    editarVenta.mockRejectedValue(new ErrorApi("fallo", 409, "Ya existe la nota 77 en esta sucursal."));
    const { usuario, onGuardada } = await prepararFormulario();
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe la nota 77 en esta sucursal.");
    expect(onGuardada).not.toHaveBeenCalled();
  });

  it("sin productos no manda nada", async () => {
    const { usuario } = await prepararFormulario();
    await usuario.clear(screen.getByLabelText("Cantidad de Horchata 1 L"));
    await usuario.clear(screen.getByLabelText("Promoción de Horchata 1 L"));
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Captura al menos un producto.");
    expect(editarVenta).not.toHaveBeenCalled();
  });

  // Review Focus 5
  it("doble clic en Guardar graba una sola vez", async () => {
    let terminar!: (v: VentaDetalle) => void;
    editarVenta.mockReturnValue(
      new Promise<VentaDetalle>((r) => {
        terminar = r;
      }),
    );
    const { usuario, onGuardada } = await prepararFormulario();
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await usuario.click(screen.getByRole("button", { name: "Guardando…" }));
    expect(editarVenta).toHaveBeenCalledTimes(1);
    terminar(VENTA);
    await vi.waitFor(() => expect(onGuardada).toHaveBeenCalledTimes(1));
  });

  it("Cancelar no graba", async () => {
    const { usuario, onCancelar } = await prepararFormulario();
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(editarVenta).not.toHaveBeenCalled();
  });
});
