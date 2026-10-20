import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as peticionesLib from "@/lib/peticiones";
import * as ventasLib from "@/lib/ventas";
import type { VentaDetalle } from "@/lib/ventas";
import { DetalleVenta } from "./detalle-venta";

vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    eliminarVenta: vi.fn(),
    marcarCuentaPerdida: vi.fn(),
    obtenerVenta: vi.fn(),
    descargarFirmaVenta: vi.fn(),
  };
});
vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return { ...real, vistaBorradoDeCobro: vi.fn(), pedirBorrarCobro: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const eliminarVenta = vi.mocked(ventasLib.eliminarVenta);
const marcarCuentaPerdida = vi.mocked(ventasLib.marcarCuentaPerdida);
const obtenerVenta = vi.mocked(ventasLib.obtenerVenta);
const descargarFirmaVenta = vi.mocked(ventasLib.descargarFirmaVenta);
const vistaBorradoDeCobro = vi.mocked(peticionesLib.vistaBorradoDeCobro);
const pedirBorrarCobro = vi.mocked(peticionesLib.pedirBorrarCobro);

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
  facturaNumero: null,
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
  cobros: [{ id: "a1", fechaPago: "2024-03-05", metodoPago: "efectivo", montoCentavos: 10000, origen: "cobro", cobroId: "co1", peticionPendiente: false }],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: true,
  // T-73: la venta de prueba es del portal: no espera firma.
  firma: { esperada: false, nombre: null, subidaEn: null },
  editada: false,
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
    // jsdom no tiene almacén de blobs (ver foto-prospecto.test.tsx).
    URL.createObjectURL = vi.fn(() => "blob:firma");
    URL.revokeObjectURL = vi.fn();
    descargarFirmaVenta.mockResolvedValue(new Blob(["firma"]));
  });

  it("una venta facturada muestra su número", () => {
    renderizar({
      ...VENTA,
      factura: "facturada",
      facturaNumero: "A780",
      editable: false,
      motivoNoEditable:
        "Esta venta está en la factura A780: quítala primero de la factura para editarla o eliminarla.",
    });
    expect(screen.getByText("Facturada · A780")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByText(/quítala primero de la factura/)).toBeInTheDocument();
  });

  it("una venta sin nota de papel dice Sin nota", () => {
    renderizar({ ...VENTA, numNota: null });
    expect(screen.getByText("Sin nota")).toBeInTheDocument();
  });

  it("muestra cabecera, líneas y cobros; sin vendedor es Oficina", () => {
    renderizar();
    expect(screen.getByText("Venta TJ240304OF01")).toBeInTheDocument();
    expect(screen.getByText("Oficina")).toBeInTheDocument();
    expect(screen.getByText("Abonado")).toHaveAttribute("data-tono", "informacion");
    expect(screen.getByText("04/03/2024")).toBeInTheDocument();
    expect(screen.getByText("05/03/2024")).toBeInTheDocument();
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

  it("Eliminar pregunta en la ventana y, si se cancela, no hace nada", async () => {
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    const ventana = screen.getByRole("alertdialog", { name: "¿Eliminar la venta TJ240304OF01 (nota 1234)?" });
    expect(ventana).toHaveTextContent("No se puede deshacer.");
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(eliminarVenta).not.toHaveBeenCalled();
    expect(onEliminada).not.toHaveBeenCalled();
  });

  // Review Focus 5 (T-17) y Review Focus 4 (UI Etapa 1)
  it("Eliminar confirmado llama una sola vez aunque se pulse dos veces, y avisa al terminar", async () => {
    let terminar!: (v: { id: string }) => void;
    eliminarVenta.mockReturnValue(
      new Promise<{ id: string }>((r) => {
        terminar = r;
      }),
    );
    const { usuario, onEliminada } = renderizar();
    const boton = screen.getByRole("button", { name: "Eliminar" });
    await usuario.click(boton);
    // Dos clics seguidos en "Eliminar venta": el primero cierra la ventana, el segundo no hace nada.
    const confirmarBoton = screen.getByRole("button", { name: "Eliminar venta" });
    fireEvent.click(confirmarBoton);
    fireEvent.click(confirmarBoton);
    // Mientras se elimina el botón queda apagado: otro clic no abre otra pregunta.
    await vi.waitFor(() => expect(boton).toBeDisabled());
    await usuario.click(boton);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(eliminarVenta).toHaveBeenCalledTimes(1);
    expect(eliminarVenta).toHaveBeenCalledWith("v1");
    terminar({ id: "v1" });
    await vi.waitFor(() => expect(onEliminada).toHaveBeenCalledTimes(1));
  });

  it("Marcar como cuenta perdida pregunta en la ventana y entrega la venta actualizada", async () => {
    const actualizada = { ...VENTA, status: "cuenta_perdida" as const, editable: false, puedeMarcarPerdida: false };
    marcarCuentaPerdida.mockResolvedValue(actualizada);
    const { usuario, onCambiada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Marcar como cuenta perdida" }));
    expect(
      screen.getByRole("alertdialog", { name: "¿Marcar la venta TJ240304OF01 como cuenta perdida?" }),
    ).toHaveTextContent("La venta dejará de cobrarse.");
    await usuario.click(screen.getByRole("button", { name: "Marcar como perdida" }));
    await vi.waitFor(() => expect(onCambiada).toHaveBeenCalledWith(actualizada));
  });

  it("un abono de saldo a favor (T-21) se ve como Saldo a favor, en método y en origen", () => {
    renderizar({
      ...VENTA,
      cobros: [
        { id: "a2", fechaPago: "2024-03-06", metodoPago: "saldo_favor", montoCentavos: 5000, origen: "saldo_favor", cobroId: "co2", peticionPendiente: false },
      ],
    });
    expect(screen.getAllByText("Saldo a favor")).toHaveLength(2);
  });

  it("muestra el mensaje del servidor", async () => {
    eliminarVenta.mockRejectedValue(new ErrorApi("fallo", 409, "Tiene cobros registrados: no se puede eliminar."));
    const { usuario, onEliminada } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    await usuario.click(screen.getByRole("button", { name: "Eliminar venta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tiene cobros registrados: no se puede eliminar.");
    expect(onEliminada).not.toHaveBeenCalled();
  });

  describe("pedir borrado (T-34)", () => {
    const ETIQUETA = "Pedir borrado del cobro del 05/03/2024 por $100.00";

    it("con cobranza.editar_eliminar, un cobro que es un pago tiene Pedir borrado; el de contado no", () => {
      renderizar({
        ...VENTA,
        cobros: [
          ...VENTA.cobros,
          {
            id: "a9",
            fechaPago: "2024-03-04",
            metodoPago: "efectivo",
            montoCentavos: 5000,
            origen: "venta_contado",
            cobroId: null,
            peticionPendiente: false,
          },
        ],
      });
      expect(screen.getByRole("button", { name: ETIQUETA })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /^Pedir borrado/ })).toHaveLength(1);
    });

    it("un pago con petición pendiente dice Borrado pedido · pendiente", () => {
      renderizar({ ...VENTA, cobros: [{ ...VENTA.cobros[0], peticionPendiente: true }] });
      expect(screen.getByText("Borrado pedido · pendiente")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: ETIQUETA })).not.toBeInTheDocument();
    });

    it("sin el permiso no se ve Pedir borrado", () => {
      mockAuth((clave) => clave !== "cobranza.editar_eliminar");
      renderizar();
      expect(screen.queryByRole("button", { name: ETIQUETA })).not.toBeInTheDocument();
    });

    it("al enviar la petición recarga la venta y muestra el aviso", async () => {
      vistaBorradoDeCobro.mockResolvedValue({
        cobro: {
          id: "co1",
          clienteId: "c1",
          cliente: "Abarrotes Lupita",
          sucursalCodigo: "TJ",
          origen: "cobro",
          metodoPago: "efectivo",
          montoCentavos: 10000,
          fechaPago: "2024-03-05",
          fechaOperacion: "2024-03-05",
          cobrador: null,
        },
        notas: [],
        saldoFavorAntesCentavos: 0,
        saldoFavorDespuesCentavos: 0,
        movimientoSaldoFavorCentavos: 0,
        bloqueo: null,
      });
      pedirBorrarCobro.mockResolvedValue({
        id: "p1",
        tipo: "eliminar_cobro",
        status: "pendiente",
        sucursalCodigo: "TJ",
        motivo: "x",
        solicito: "Ana",
        creadaEn: "2024-03-06 10:00",
        resolvio: null,
        resueltaEn: null,
        comentario: null,
        cobro: {
          id: "co1",
          clienteId: "c1",
          cliente: "Abarrotes Lupita",
          montoCentavos: 10000,
          metodoPago: "efectivo",
          origen: "cobro",
          fechaPago: "2024-03-05",
          cobrador: null,
          folios: ["TJ240304OF01"],
        },
      });
      const actualizada = { ...VENTA, cobros: [{ ...VENTA.cobros[0], peticionPendiente: true }] };
      obtenerVenta.mockResolvedValue(actualizada);

      const { usuario, onCambiada } = renderizar();
      await usuario.click(screen.getByRole("button", { name: ETIQUETA }));
      expect(vistaBorradoDeCobro).toHaveBeenCalledWith("co1");
      await usuario.type(await screen.findByLabelText("Motivo"), "Era de crédito");
      await usuario.click(screen.getByRole("button", { name: "Enviar petición" }));

      await vi.waitFor(() => expect(onCambiada).toHaveBeenCalledWith(actualizada));
      expect(obtenerVenta).toHaveBeenCalledWith("v1");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Petición enviada: borrar el pago de $100.00 de Abarrotes Lupita.",
      );
    });
  });
});

describe("DetalleVenta · firma del cliente (T-73)", () => {
  const conFirma = (firma: VentaDetalle["firma"], editada = false): VentaDetalle => ({
    ...VENTA,
    origen: "app",
    firma,
    editada,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(() => true);
    URL.createObjectURL = vi.fn(() => "blob:firma");
    URL.revokeObjectURL = vi.fn();
    descargarFirmaVenta.mockResolvedValue(new Blob(["firma"]));
  });

  it("subida: la imagen, quién firmó y que se firmó en la tablet", async () => {
    renderizar(conFirma({ esperada: true, nombre: "Doña Lupe", subidaEn: "2026-10-21T19:00:00.000Z" }));
    const imagen = await screen.findByAltText("Firma del cliente");
    expect(imagen).toHaveAttribute("src", "blob:firma");
    expect(descargarFirmaVenta).toHaveBeenCalledWith("v1");
    expect(screen.getByText("Firmó: Doña Lupe")).toBeInTheDocument();
    expect(screen.getByText("Firmada en la tablet")).toBeInTheDocument();
  });

  it("subida sin nombre: sin la línea de quién firmó", async () => {
    renderizar(conFirma({ esperada: true, nombre: null, subidaEn: "2026-10-21T19:00:00.000Z" }));
    await screen.findByAltText("Firma del cliente");
    expect(screen.queryByText(/^Firmó:/)).not.toBeInTheDocument();
  });

  it("esperada y sin subir: pendiente de la sincronización, sin pedir la imagen", () => {
    renderizar(conFirma({ esperada: true, nombre: "Doña Lupe", subidaEn: null }));
    expect(
      screen.getByText("Firma pendiente de subir: llega cuando el vendedor sincronice."),
    ).toBeInTheDocument();
    expect(descargarFirmaVenta).not.toHaveBeenCalled();
  });

  it("no esperada: sin firma, sin pedir la imagen", () => {
    renderizar(conFirma({ esperada: false, nombre: null, subidaEn: null }));
    expect(
      screen.getByText("Sin firma (venta capturada en oficina o anterior a la firma en tablet)."),
    ).toBeInTheDocument();
    expect(descargarFirmaVenta).not.toHaveBeenCalled();
  });

  it("firmada y editada en el portal: avisa que la firma es de la versión original", async () => {
    renderizar(conFirma({ esperada: true, nombre: null, subidaEn: "2026-10-21T19:00:00.000Z" }, true));
    await screen.findByAltText("Firma del cliente");
    expect(
      screen.getByText(
        "Esta nota se editó en el portal después de firmarse; la firma corresponde a la versión original.",
      ),
    ).toBeInTheDocument();
  });

  it("editada pero sin firma: no hay aviso", () => {
    renderizar(conFirma({ esperada: false, nombre: null, subidaEn: null }, true));
    expect(screen.queryByText(/después de firmarse/)).not.toBeInTheDocument();
  });

  it("si la imagen no baja, lo dice sin romper el detalle", async () => {
    descargarFirmaVenta.mockRejectedValue(new Error("red"));
    renderizar(conFirma({ esperada: true, nombre: "Doña Lupe", subidaEn: "2026-10-21T19:00:00.000Z" }));
    await waitFor(() => expect(screen.getByText("No se pudo cargar la firma.")).toBeInTheDocument());
    expect(screen.getByText("Firmó: Doña Lupe")).toBeInTheDocument();
  });
});
