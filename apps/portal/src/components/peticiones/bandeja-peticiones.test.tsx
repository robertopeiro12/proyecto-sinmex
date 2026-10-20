import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as peticionesLib from "@/lib/peticiones";
import type { PeticionEnBandeja, VistaBorrado } from "@/lib/peticiones";
import { BandejaPeticiones } from "./bandeja-peticiones";

vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return {
    ...real,
    listarPeticiones: vi.fn(),
    vistaPreviaDePeticion: vi.fn(),
    autorizarPeticion: vi.fn(),
    denegarPeticion: vi.fn(),
  };
});

const listarPeticiones = vi.mocked(peticionesLib.listarPeticiones);
const vistaPreviaDePeticion = vi.mocked(peticionesLib.vistaPreviaDePeticion);
const autorizarPeticion = vi.mocked(peticionesLib.autorizarPeticion);
const denegarPeticion = vi.mocked(peticionesLib.denegarPeticion);

const PENDIENTE: PeticionEnBandeja = {
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
    folios: ["TJ261001AP01", "TJ261003AP02"],
  },
};

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
  notas: [],
  saldoFavorAntesCentavos: 0,
  saldoFavorDespuesCentavos: 0,
  movimientoSaldoFavorCentavos: 0,
  bloqueo: null,
};

const BOTON_AUTORIZAR = "Autorizar petición de Tacos Erick";
const BOTON_DENEGAR = "Denegar petición de Tacos Erick";

describe("BandejaPeticiones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarPeticiones.mockResolvedValue([PENDIENTE]);
    vistaPreviaDePeticion.mockResolvedValue(VISTA);
  });

  it("pendientes: quién pidió, cliente, el pago, sus notas y el motivo, con sus botones", async () => {
    render(<BandejaPeticiones status="pendiente" sucursal="TJ" />);
    expect(await screen.findByText("Era de crédito")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenCalledWith("pendiente", "TJ");
    expect(screen.getByText("13/10/2026 09:15")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Tacos Erick · TJ")).toBeInTheDocument();
    expect(
      screen.getByText("Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Efectivo · cobró Juan Pérez"),
    ).toBeInTheDocument();
    expect(screen.getByText("TJ261001AP01, TJ261003AP02")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BOTON_AUTORIZAR })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BOTON_DENEGAR })).toBeInTheDocument();
  });

  it("vacías: lo dice según la pestaña", async () => {
    listarPeticiones.mockResolvedValue([]);
    const { unmount } = render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    expect(await screen.findByText("No hay peticiones pendientes.")).toBeInTheDocument();
    unmount();
    render(<BandejaPeticiones status="historial" sucursal={null} />);
    expect(await screen.findByText("No hay peticiones resueltas.")).toBeInTheDocument();
  });

  it("historial: resultado, quién y cuándo resolvió, y el comentario; sin botones", async () => {
    listarPeticiones.mockResolvedValue([
      { ...PENDIENTE, status: "denegada", resolvio: "Beto", resueltaEn: "2026-10-13 10:00", comentario: "No procede" },
    ]);
    render(<BandejaPeticiones status="historial" sucursal={null} />);
    expect(await screen.findByText("Denegada")).toHaveAttribute("data-tono", "neutro");
    expect(screen.getByText("Beto · 13/10/2026 10:00")).toBeInTheDocument();
    expect(screen.getByText("No procede")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BOTON_AUTORIZAR })).not.toBeInTheDocument();
  });

  it("autorizar: vista previa recalculada, confirmar, aviso y la lista se recarga", async () => {
    autorizarPeticion.mockResolvedValue({ ...PENDIENTE, status: "autorizada" });
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_AUTORIZAR }));
    expect(vistaPreviaDePeticion).toHaveBeenCalledWith("p1");
    const confirmar = screen.getByRole("button", { name: "Confirmar y borrar" });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.click(confirmar);

    expect(autorizarPeticion).toHaveBeenCalledWith("p1");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Petición autorizada: se borró el pago de $1,000.00 de Tacos Erick.",
    );
    expect(listarPeticiones).toHaveBeenCalledTimes(2);
  });

  it("con el saldo a favor ya aplicado no deja confirmar y dice por qué", async () => {
    vistaPreviaDePeticion.mockResolvedValue({
      ...VISTA,
      bloqueo: {
        codigo: "saldo-favor-aplicado",
        motivo: "El saldo a favor que dejó este pago ya se aplicó a otras notas. Primero borra el pago que lo aplicó.",
      },
    });
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_AUTORIZAR }));
    expect(await screen.findByText(/ya se aplicó a otras notas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar y borrar" })).toBeDisabled();
  });

  it("Review Focus 5: un 409 al autorizar se ve como alerta y la lista se recarga", async () => {
    autorizarPeticion.mockRejectedValue(new ErrorApi("fallo", 409, "Esta petición ya fue resuelta."));
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_AUTORIZAR }));
    const confirmar = screen.getByRole("button", { name: "Confirmar y borrar" });
    await waitFor(() => expect(confirmar).toBeEnabled());
    await usuario.click(confirmar);
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta petición ya fue resuelta.");
    await vi.waitFor(() => expect(listarPeticiones).toHaveBeenCalledTimes(2));
  });

  it("Review Focus 5: si la vista previa ya no se puede calcular (409), alerta y recarga", async () => {
    vistaPreviaDePeticion.mockRejectedValue(new ErrorApi("fallo", 409, "Este cobro ya se borró."));
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_AUTORIZAR }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este cobro ya se borró.");
    await vi.waitFor(() => expect(listarPeticiones).toHaveBeenCalledTimes(2));
  });

  it("denegar con comentario: aviso y recarga", async () => {
    denegarPeticion.mockResolvedValue({ ...PENDIENTE, status: "denegada", comentario: "No procede" });
    const usuario = userEvent.setup();
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: BOTON_DENEGAR }));
    await usuario.type(screen.getByLabelText("Comentario (opcional)"), "No procede");
    await usuario.click(screen.getByRole("button", { name: "Confirmar denegación" }));

    expect(denegarPeticion).toHaveBeenCalledWith("p1", "No procede");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Petición denegada: el pago de Tacos Erick no cambia.",
    );
    expect(listarPeticiones).toHaveBeenCalledTimes(2);
  });

  it("si no carga, lo dice", async () => {
    listarPeticiones.mockRejectedValue(new ErrorApi("fallo", 500));
    render(<BandejaPeticiones status="pendiente" sucursal={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las peticiones.");
  });
});
