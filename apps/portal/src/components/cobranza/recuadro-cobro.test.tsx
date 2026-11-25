import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as cobranzasLib from "@/lib/cobranzas";
import type { ClientePorCobrar, NotaPorCobrar, PlanDeCobro } from "@/lib/cobranzas";
import * as ventasLib from "@/lib/ventas";
import { RecuadroCobro } from "./recuadro-cobro";

vi.mock("@/lib/cobranzas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cobranzas")>();
  return { ...real, porCobrarDeCliente: vi.fn(), vistaPreviaCobro: vi.fn(), registrarCobro: vi.fn(), aplicarSaldoFavor: vi.fn() };
});
vi.mock("@/lib/ventas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ventas")>();
  return { ...real, listarRepartidores: vi.fn() };
});

const vistaPreviaCobro = vi.mocked(cobranzasLib.vistaPreviaCobro);

const N1: NotaPorCobrar = {
  id: "n1", folio: "TJ261120OF01", numNota: null, fecha: "2026-11-20", clienteId: "c1", cliente: "Cobach",
  sucursalCodigo: "TJ", montoCentavos: 200000, saldoCentavos: 200000, status: "pendiente", abonos: [],
};
const DATOS: ClientePorCobrar = {
  id: "c1", nombre: "Cobach", sucursalId: "s", sucursalCodigo: "TJ", saldoFavorCentavos: 50000, notas: [N1],
};
const plan = (monto: number): PlanDeCobro => ({
  aplicaciones: [
    { notaId: "n1", folio: "TJ261120OF01", numNota: null, fecha: "2026-11-20", montoCentavos: monto, saldoAntesCentavos: 200000, saldoDespuesCentavos: 200000 - monto, status: "abonado", palomeada: true },
  ],
  saldoFavorCentavos: 0,
});

/** Promesas que la prueba resuelve en el orden que quiere. */
function diferidas() {
  const pendientes: { resolver: (p: PlanDeCobro) => void; fallar: (e: unknown) => void }[] = [];
  vistaPreviaCobro.mockImplementation(
    () => new Promise<PlanDeCobro>((resolver, fallar) => pendientes.push({ resolver, fallar })),
  );
  return pendientes;
}

async function abrir() {
  const u = userEvent.setup();
  render(<RecuadroCobro clienteId="c1" notaIds={["n1"]} onTerminado={vi.fn()} onCancelar={vi.fn()} onSucio={vi.fn()} />);
  const recuadro = await screen.findByRole("region", { name: "Cobrar 1 nota" });
  await within(recuadro).findByLabelText("Monto");
  return { u, recuadro };
}

describe("RecuadroCobro (revisión T-2): respuestas de la vista previa fuera de orden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cobranzasLib.porCobrarDeCliente).mockResolvedValue(DATOS);
    vi.mocked(ventasLib.listarRepartidores).mockResolvedValue([]);
  });

  it("pago: la respuesta vieja que llega tarde no pisa a la nueva", async () => {
    const pendientes = diferidas();
    const { u, recuadro } = await abrir();
    await u.type(within(recuadro).getByLabelText("Monto"), "100");
    await waitFor(() => expect(pendientes).toHaveLength(1));
    await u.type(within(recuadro).getByLabelText("Monto"), "0");
    await waitFor(() => expect(pendientes).toHaveLength(2));
    pendientes[1].resolver(plan(100000));
    expect(await within(recuadro).findByText(/abono \$1,000\.00/)).toBeInTheDocument();
    pendientes[0].resolver(plan(10000));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(recuadro).getByText(/abono \$1,000\.00/)).toBeInTheDocument();
    expect(within(recuadro).getByRole("button", { name: "Grabar pago" })).toBeEnabled();
  });

  it("pago: el error de una petición vieja no se pinta junto a un Así queda bueno", async () => {
    const pendientes = diferidas();
    const { u, recuadro } = await abrir();
    await u.type(within(recuadro).getByLabelText("Monto"), "100");
    await waitFor(() => expect(pendientes).toHaveLength(1));
    await u.type(within(recuadro).getByLabelText("Monto"), "0");
    await waitFor(() => expect(pendientes).toHaveLength(2));
    pendientes[1].resolver(plan(100000));
    await within(recuadro).findByText(/abono \$1,000\.00/);
    pendientes[0].fallar(new ErrorApi("x", 400, "Falló la vieja."));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(recuadro).queryByText("Falló la vieja.")).toBeNull();
    expect(within(recuadro).getByRole("button", { name: "Grabar pago" })).toBeEnabled();
  });

  it("saldo a favor: la respuesta vieja que llega tarde no pisa a la nueva", async () => {
    const pendientes = diferidas();
    const { u, recuadro } = await abrir();
    await u.click(within(recuadro).getByRole("button", { name: "Usar saldo a favor ($500.00)" }));
    // La primera sale sola con el monto propuesto (500.00).
    await waitFor(() => expect(pendientes).toHaveLength(1));
    const campo = within(recuadro).getByLabelText("Monto a aplicar");
    await u.clear(campo);
    await u.type(campo, "400");
    await waitFor(() => expect(pendientes).toHaveLength(2));
    pendientes[1].resolver(plan(40000));
    expect(await within(recuadro).findByText(/abono \$400\.00/)).toBeInTheDocument();
    pendientes[0].resolver(plan(50000));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(recuadro).getByText(/abono \$400\.00/)).toBeInTheDocument();
    expect(within(recuadro).getByRole("button", { name: "Aplicar saldo a favor" })).toBeEnabled();
  });
});
