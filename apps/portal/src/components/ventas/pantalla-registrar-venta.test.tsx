import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as clientesLib from "@/lib/clientes";
import type { ClienteDetalle, ClienteResumen } from "@/lib/clientes";
import * as ventasLib from "@/lib/ventas";
import type { PresentacionDeCatalogo, VentaRegistrada } from "@/lib/ventas";
import { PantallaRegistrarVenta } from "./pantalla-registrar-venta";

// Mismo limite que pantalla-clientes.test.tsx: se mockea la capa de red
// (lib/*.ts), no apiFetch. De lib/ventas se conservan las utilidades puras.
vi.mock("@/lib/clientes");
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return {
    ...real,
    obtenerCatalogoVenta: vi.fn(),
    listarRepartidores: vi.fn(),
    registrarVenta: vi.fn(),
  };
});
vi.mock("@/components/auth/auth-provider");

const listarClientes = vi.mocked(clientesLib.listarClientes);
const obtenerCliente = vi.mocked(clientesLib.obtenerCliente);
const obtenerCatalogoVenta = vi.mocked(ventasLib.obtenerCatalogoVenta);
const listarRepartidores = vi.mocked(ventasLib.listarRepartidores);
const registrarVenta = vi.mocked(ventasLib.registrarVenta);

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

const CLIENTE: ClienteResumen = {
  id: "c1",
  nombre: "Abarrotes Lupita",
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
};

const CATALOGO: PresentacionDeCatalogo[] = [
  { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 },
  { presentacionId: "p2", producto: "Jamaica", volumen: "500 ml", precioCentavos: 600 },
  { presentacionId: "p3", producto: "Tamarindo", volumen: "2 L", precioCentavos: null },
];

const REGISTRADA: VentaRegistrada = {
  id: "v1",
  folio: "TJ261006OF01",
  montoCentavos: 27000,
  status: "pagada",
};

/** Renderiza, elige el cliente y espera a que carguen productos y repartidores. */
async function prepararPantalla() {
  const usuario = userEvent.setup();
  render(<PantallaRegistrarVenta sucursal={null} />);
  await usuario.type(screen.getByLabelText("Cliente"), "lupi");
  await usuario.click(await screen.findByRole("button", { name: /Abarrotes Lupita/ }));
  await screen.findByLabelText("Cantidad de Horchata 1 L");
  await screen.findByRole("option", { name: "Ana Pérez" });
  return usuario;
}

describe("PantallaRegistrarVenta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(() => true);
    listarClientes.mockResolvedValue([CLIENTE]);
    obtenerCliente.mockResolvedValue({ id: "c1", sucursalId: "suc-tj" } as ClienteDetalle);
    listarRepartidores.mockResolvedValue([{ id: "v-ana", nombre: "Ana Pérez" }]);
    obtenerCatalogoVenta.mockResolvedValue(CATALOGO);
    registrarVenta.mockResolvedValue(REGISTRADA);
  });

  it("arma el payload sin precios, con el repartidor elegido, y muestra la venta creada", async () => {
    const usuario = await prepararPantalla();
    expect(obtenerCatalogoVenta).toHaveBeenCalledWith("c1", ventasLib.hoyEnTijuana());
    expect(listarRepartidores).toHaveBeenCalledWith("suc-tj");

    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "v-ana");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "24");
    await usuario.type(screen.getByLabelText("Promoción de Horchata 1 L"), "2");
    await usuario.type(screen.getByLabelText("Cantidad de Jamaica 500 ml"), "5");
    await usuario.type(screen.getByLabelText("Número de nota (opcional)"), "1234");

    expect(screen.getByText("Total: $270.00")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(registrarVenta).toHaveBeenCalledWith({
      fecha: ventasLib.hoyEnTijuana(),
      clienteId: "c1",
      vendedorId: "v-ana",
      numNota: "1234",
      contadoCredito: "contado",
      metodoPago: "transferencia",
      factura: "N/A",
      lineas: [
        { presentacionId: "p1", cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: "p2", cantidad: 5, cantidadPromocion: 0 },
      ],
    });
    const resultado = await screen.findByRole("status");
    expect(resultado).toHaveTextContent("TJ261006OF01");
    expect(resultado).toHaveTextContent("$270.00");
    expect(resultado).toHaveTextContent("Pagada");
    expect(screen.getByRole("button", { name: "Registrar otra" })).toBeInTheDocument();
  });

  it("Oficina manda vendedorId null, y a crédito no manda método de pago", async () => {
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.selectOptions(screen.getByLabelText("Contado o crédito"), "credito");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "1");
    await usuario.type(screen.getByLabelText("Número de nota (opcional)"), "77");
    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(registrarVenta).toHaveBeenCalledTimes(1);
    const enviada = registrarVenta.mock.calls[0][0];
    expect(enviada.vendedorId).toBeNull();
    expect(enviada.contadoCredito).toBe("credito");
    expect(enviada).not.toHaveProperty("metodoPago");
  });

  it("una presentación sin precio a esa fecha aparece deshabilitada", async () => {
    await prepararPantalla();
    expect(screen.getByLabelText("Cantidad de Tamarindo 2 L")).toBeDisabled();
    expect(screen.getByLabelText("Promoción de Tamarindo 2 L")).toBeDisabled();
    expect(screen.getByText("sin precio en la lista")).toBeInTheDocument();
  });

  it("muestra el mensaje del servidor", async () => {
    registrarVenta.mockRejectedValue(
      new ErrorApi("fallo", 409, "Ya existe la nota 1234 en esta sucursal."),
    );
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "1");
    await usuario.type(screen.getByLabelText("Número de nota (opcional)"), "1234");
    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe la nota 1234 en esta sucursal.",
    );
  });

  it("sin el permiso venta.registrar no aparece Grabar", async () => {
    mockAuth(() => false);
    await prepararPantalla();
    expect(screen.queryByRole("button", { name: "Grabar" })).not.toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para registrar ventas.")).toBeInTheDocument();
  });

  // Review Focus 4
  it("no manda nada sin productos", async () => {
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.type(screen.getByLabelText("Número de nota (opcional)"), "1");
    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Captura al menos un producto.");
    expect(registrarVenta).not.toHaveBeenCalled();
  });

  // Review Focus 5
  it("una cantidad no entera se avisa en vez de mandarse", async () => {
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    // userEvent.type teclea "2", "2." (que jsdom sanea a "") y "5": nunca llega a "2.5".
    fireEvent.change(screen.getByLabelText("Cantidad de Horchata 1 L"), {
      target: { value: "2.5" },
    });
    await usuario.type(screen.getByLabelText("Número de nota (opcional)"), "1");
    await usuario.click(screen.getByRole("button", { name: "Grabar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Las cantidades deben ser números enteros de 0 en adelante.",
    );
    expect(registrarVenta).not.toHaveBeenCalled();
  });

  // Review Focus 3
  it("doble clic graba una sola vez", async () => {
    let terminar!: (v: VentaRegistrada) => void;
    registrarVenta.mockReturnValue(
      new Promise<VentaRegistrada>((r) => {
        terminar = r;
      }),
    );
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "1");
    await usuario.type(screen.getByLabelText("Número de nota (opcional)"), "1");

    const grabar = screen.getByRole("button", { name: "Grabar" });
    await usuario.click(grabar);
    await usuario.click(screen.getByRole("button", { name: "Grabando…" }));

    expect(registrarVenta).toHaveBeenCalledTimes(1);
    terminar(REGISTRADA);
    await screen.findByRole("status");
  });

  // Review Focus 2
  it("cambiar la fecha recarga precios y no manda líneas que quedaron sin precio", async () => {
    const usuario = await prepararPantalla();
    await usuario.selectOptions(screen.getByLabelText("Repartidor"), "oficina");
    await usuario.type(screen.getByLabelText("Cantidad de Horchata 1 L"), "3");
    await usuario.type(screen.getByLabelText("Cantidad de Jamaica 500 ml"), "2");
    await usuario.type(screen.getByLabelText("Número de nota (opcional)"), "9");

    // A esa fecha la Horchata todavia no tenia precio.
    obtenerCatalogoVenta.mockResolvedValue([
      { ...CATALOGO[0], precioCentavos: null },
      CATALOGO[1],
      CATALOGO[2],
    ]);
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-01-15" } });
    await waitFor(() =>
      expect(screen.getByLabelText("Cantidad de Horchata 1 L")).toBeDisabled(),
    );
    expect(obtenerCatalogoVenta).toHaveBeenLastCalledWith("c1", "2026-01-15");
    expect(screen.getByText("Total: $12.00")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Grabar" }));
    expect(registrarVenta).toHaveBeenCalledWith(
      expect.objectContaining({
        fecha: "2026-01-15",
        lineas: [{ presentacionId: "p2", cantidad: 2, cantidadPromocion: 0 }],
      }),
    );
  });

  it("el error de carga del catálogo desaparece al corregir la fecha", async () => {
    await prepararPantalla();
    obtenerCatalogoVenta.mockRejectedValueOnce(new Error("falla"));
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-01-15" } });
    expect(
      await screen.findByText("No se pudieron cargar los productos del cliente."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-01-16" } });
    await waitFor(() =>
      expect(
        screen.queryByText("No se pudieron cargar los productos del cliente."),
      ).not.toBeInTheDocument(),
    );
  });
});
