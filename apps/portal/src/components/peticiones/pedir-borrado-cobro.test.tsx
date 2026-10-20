import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as peticionesLib from "@/lib/peticiones";
import type { PeticionEnBandeja, VistaBorrado } from "@/lib/peticiones";
import { PedirBorradoCobro } from "./pedir-borrado-cobro";

vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return { ...real, vistaBorradoDeCobro: vi.fn(), pedirBorrarCobro: vi.fn() };
});

const vistaBorradoDeCobro = vi.mocked(peticionesLib.vistaBorradoDeCobro);
const pedirBorrarCobro = vi.mocked(peticionesLib.pedirBorrarCobro);

const VISTA: VistaBorrado = {
  cobro: {
    id: "co1",
    clienteId: "c1",
    cliente: "Tacos Erick",
    sucursalCodigo: "TJ",
    origen: "cobro",
    metodoPago: "efectivo",
    montoCentavos: 100000,
    fechaPago: "2026-10-10",
    fechaOperacion: "2026-10-10",
    cobrador: "Juan Pérez",
  },
  notas: [
    {
      notaId: "n1",
      folio: "TJ261001AP01",
      numNota: "77",
      fecha: "2026-10-01",
      delPagoCentavos: 40000,
      saldoAntesCentavos: 0,
      saldoDespuesCentavos: 40000,
      statusDespues: "abonado",
    },
  ],
  saldoFavorAntesCentavos: 30000,
  saldoFavorDespuesCentavos: 20000,
  movimientoSaldoFavorCentavos: 10000,
  bloqueo: null,
};

const PETICION: PeticionEnBandeja = {
  id: "p1",
  tipo: "eliminar_cobro",
  status: "pendiente",
  sucursalCodigo: "TJ",
  motivo: "Era de crédito",
  solicito: "Ana",
  creadaEn: "2026-10-13 09:15",
  resolvio: null,
  resueltaEn: null,
  comentario: null,
  cobro: {
    id: "co1",
    clienteId: "c1",
    cliente: "Tacos Erick",
    montoCentavos: 100000,
    metodoPago: "efectivo",
    origen: "cobro",
    fechaPago: "2026-10-10",
    cobrador: "Juan Pérez",
    folios: ["TJ261001AP01"],
  },
};

function renderizar() {
  const props = { onEnviada: vi.fn(), onDesactualizado: vi.fn(), onCancelar: vi.fn() };
  render(<PedirBorradoCobro cobroId="co1" {...props} />);
  return { usuario: userEvent.setup(), ...props };
}

describe("PedirBorradoCobro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vistaBorradoDeCobro.mockResolvedValue(VISTA);
    pedirBorrarCobro.mockResolvedValue(PETICION);
  });

  it("muestra el pago y cómo quedaría cada nota y el saldo a favor", async () => {
    renderizar();
    expect(
      await screen.findByText("Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Efectivo · cobró Juan Pérez"),
    ).toBeInTheDocument();
    expect(vistaBorradoDeCobro).toHaveBeenCalledWith("co1");
    expect(screen.getByText("TJ261001AP01")).toBeInTheDocument();
    expect(screen.getByText("Abonado")).toBeInTheDocument();
    expect(screen.getByText("Saldo a favor: $300.00 → $200.00")).toBeInTheDocument();
  });

  it("sin motivo no se envía; con motivo manda la petición y avisa", async () => {
    const { usuario, onEnviada } = renderizar();
    await screen.findByText("TJ261001AP01");
    const enviar = screen.getByRole("button", { name: "Enviar petición" });
    expect(enviar).toBeDisabled();
    await usuario.type(screen.getByLabelText("Motivo"), "Era de crédito");
    await usuario.click(enviar);
    expect(pedirBorrarCobro).toHaveBeenCalledWith("co1", "Era de crédito");
    expect(onEnviada).toHaveBeenCalledWith("Petición enviada: borrar el pago de $1,000.00 de Tacos Erick.");
  });

  it("con el saldo a favor ya aplicado lo avisa, pero deja enviar la petición", async () => {
    vistaBorradoDeCobro.mockResolvedValue({
      ...VISTA,
      saldoFavorDespuesCentavos: -6000,
      bloqueo: {
        codigo: "saldo-favor-aplicado",
        motivo: "El saldo a favor que dejó este pago ya se aplicó a otras notas. Primero borra el pago que lo aplicó.",
      },
    });
    const { usuario } = renderizar();
    expect(await screen.findByText(/ya se aplicó a otras notas/)).toBeInTheDocument();
    await usuario.type(screen.getByLabelText("Motivo"), "x");
    expect(screen.getByRole("button", { name: "Enviar petición" })).toBeEnabled();
  });

  it("Review Focus 5: un 409 al enviar avisa al padre con el mensaje del servidor", async () => {
    pedirBorrarCobro.mockRejectedValue(
      new ErrorApi("fallo", 409, "Este cobro ya tiene una petición de borrado pendiente."),
    );
    const { usuario, onDesactualizado, onEnviada } = renderizar();
    await screen.findByText("TJ261001AP01");
    await usuario.type(screen.getByLabelText("Motivo"), "x");
    await usuario.click(screen.getByRole("button", { name: "Enviar petición" }));
    expect(onDesactualizado).toHaveBeenCalledWith("Este cobro ya tiene una petición de borrado pendiente.");
    expect(onEnviada).not.toHaveBeenCalled();
  });

  it("Review Focus 5: un cobro que ya se borró (409 al cargar) avisa al padre", async () => {
    vistaBorradoDeCobro.mockRejectedValue(new ErrorApi("fallo", 409, "Este cobro ya se borró."));
    const { onDesactualizado } = renderizar();
    await vi.waitFor(() => expect(onDesactualizado).toHaveBeenCalledWith("Este cobro ya se borró."));
  });

  it("otro error al enviar se queda en el panel", async () => {
    pedirBorrarCobro.mockRejectedValue(new ErrorApi("fallo", 400, "Escribe el motivo de la petición."));
    const { usuario } = renderizar();
    await screen.findByText("TJ261001AP01");
    await usuario.type(screen.getByLabelText("Motivo"), "x");
    await usuario.click(screen.getByRole("button", { name: "Enviar petición" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe el motivo de la petición.");
  });

  it("Cancelar avisa al padre", async () => {
    const { usuario, onCancelar } = renderizar();
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });
});
