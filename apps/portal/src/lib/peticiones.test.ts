import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { ErrorApi } from "./api";
import {
  autorizarPeticion,
  denegarPeticion,
  describirPago,
  esConflicto409,
  listarPeticiones,
  pedirBorrarCobro,
  textoAutorizada,
  textoDenegada,
  textoPeticionEnviada,
  vistaBorradoDeCobro,
  vistaPreviaDePeticion,
  type PeticionEnBandeja,
} from "./peticiones";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

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

describe("lib/peticiones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({});
  });

  it("las vistas previas piden por cobro y por petición", async () => {
    await vistaBorradoDeCobro("co1");
    expect(apiFetch).toHaveBeenLastCalledWith("/cobros/co1/vista-borrado");
    await vistaPreviaDePeticion("p1");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/p1/vista-previa");
  });

  it("pedir, autorizar y denegar hacen POST", async () => {
    await pedirBorrarCobro("co1", "Era de crédito");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/eliminar-cobro", {
      method: "POST",
      body: JSON.stringify({ cobroId: "co1", motivo: "Era de crédito" }),
    });
    await autorizarPeticion("p1");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/p1/autorizar", { method: "POST" });
    await denegarPeticion("p1", "  No procede ");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/p1/denegar", {
      method: "POST",
      body: JSON.stringify({ comentario: "No procede" }),
    });
    await denegarPeticion("p1", "   ");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones/p1/denegar", {
      method: "POST",
      body: JSON.stringify({}),
    });
  });

  it("la bandeja manda el status y la sucursal si hay", async () => {
    await listarPeticiones("pendiente", "TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones?status=pendiente&sucursal=TJ");
    await listarPeticiones("historial", null);
    expect(apiFetch).toHaveBeenLastCalledWith("/peticiones?status=historial");
  });

  it("describe el pago: con cobrador, de Oficina o saldo a favor", () => {
    expect(describirPago(PETICION.cobro)).toBe(
      "Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Efectivo · cobró Juan Pérez",
    );
    expect(describirPago({ ...PETICION.cobro, cobrador: null, metodoPago: "transferencia" })).toBe(
      "Pago de $1,000.00 · Tacos Erick · 10/10/2026 · Transferencia · Oficina",
    );
    expect(
      describirPago({ ...PETICION.cobro, origen: "saldo_favor", metodoPago: "saldo_favor", cobrador: null }),
    ).toBe("Saldo a favor aplicado de $1,000.00 · Tacos Erick · 10/10/2026");
  });

  it("los avisos de enviada, autorizada y denegada", () => {
    expect(textoPeticionEnviada(PETICION)).toBe("Petición enviada: borrar el pago de $1,000.00 de Tacos Erick.");
    expect(textoAutorizada(PETICION)).toBe("Petición autorizada: se borró el pago de $1,000.00 de Tacos Erick.");
    expect(textoDenegada(PETICION)).toBe("Petición denegada: el pago de Tacos Erick no cambia.");
  });

  it("esConflicto409 solo reconoce un ErrorApi 409", () => {
    expect(esConflicto409(new ErrorApi("x", 409, "ya"))).toBe(true);
    expect(esConflicto409(new ErrorApi("x", 400, "no"))).toBe(false);
    expect(esConflicto409(new Error("x"))).toBe(false);
  });
});
