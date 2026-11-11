import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  agruparPorSucursal,
  etiquetaLiquidada,
  etiquetaRutaAsignada,
  etiquetaVehiculo,
  obtenerDashboard,
  obtenerDetalleDashboard,
  obtenerDetalleDia,
  obtenerDetalleVendedor,
  obtenerFlujoDiario,
  guardarNotasEntregadas,
  fechaRevisable,
  type PagoDetalle,
} from "./flujo-diario";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn(), apiFetchSinCuerpo: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);
const apiFetchSinCuerpo = vi.mocked(api.apiFetchSinCuerpo);

const pago = (saldo: number): PagoDetalle => ({
  folio: "TJ261013AP01",
  cliente: "Cobach XXI",
  montoCentavos: 5000,
  metodo: "efectivo",
  saldoPendienteCentavos: saldo,
  liquidada: saldo === 0,
});

describe("etiquetaRutaAsignada", () => {
  it("lleva el nombre de la ruta y pluraliza", () => {
    expect(etiquetaRutaAsignada("RUTA 5 (BLV 2000)", 16)).toBe("RUTA 5 (BLV 2000) · 16 clientes");
    expect(etiquetaRutaAsignada("RUTA 5 (BLV 2000)", 1)).toBe("RUTA 5 (BLV 2000) · 1 cliente");
  });

  it("sin nombre pero con clientes dice Sin ruta con la cuenta", () => {
    expect(etiquetaRutaAsignada(null, 3)).toBe("Sin ruta · 3 clientes");
  });

  it("sin clientes dice solo Sin ruta", () => {
    expect(etiquetaRutaAsignada(null, 0)).toBe("Sin ruta");
  });

  it("con nombre y 0 clientes dice solo el nombre, sin la cuenta", () => {
    expect(etiquetaRutaAsignada("RUTA 5 (BLV 2000)", 0)).toBe("RUTA 5 (BLV 2000)");
  });
});

describe("etiquetaVehiculo", () => {
  it("avisa cuando el usado difiere del asignado", () => {
    expect(etiquetaVehiculo("Nissan 02", "Nissan 01")).toBe("Nissan 02 (asignado: Nissan 01)");
  });

  it("si coinciden o falta uno, muestra el que haya", () => {
    expect(etiquetaVehiculo("Nissan 01", "Nissan 01")).toBe("Nissan 01");
    expect(etiquetaVehiculo("Nissan 02", null)).toBe("Nissan 02");
    expect(etiquetaVehiculo(null, "Nissan 01")).toBe("Nissan 01");
  });

  it("sin ninguno, raya", () => {
    expect(etiquetaVehiculo(null, null)).toBe("—");
  });
});

describe("etiquetaLiquidada", () => {
  it("abonado resta lo que falta", () => {
    expect(etiquetaLiquidada(pago(15000))).toEqual({
      texto: "Abonado",
      resta: "$150.00",
    });
  });
  it("saldo 0 es Sí", () => {
    expect(etiquetaLiquidada(pago(0))).toEqual({ texto: "Sí", resta: null });
  });
});

describe("agruparPorSucursal", () => {
  it("respeta el orden de llegada", () => {
    const g = agruparPorSucursal([
      { sucursalCodigo: "TJ", n: 1 },
      { sucursalCodigo: "TJ", n: 2 },
      { sucursalCodigo: "MX", n: 3 },
    ]);
    expect(g.map((x) => x.sucursalCodigo)).toEqual(["TJ", "MX"]);
    expect(g[0].filas).toHaveLength(2);
  });
});

describe("fetchers", () => {
  beforeEach(() => apiFetch.mockReset());

  it("obtenerFlujoDiario arma la consulta", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerFlujoDiario({
      desde: "2026-11-01",
      hasta: "2026-11-09",
      sucursal: "MX",
      vendedor: "v1",
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/reportes/flujo-diario?desde=2026-11-01&hasta=2026-11-09&sucursal=MX&vendedor=v1",
    );
  });
  it("omite los nulos", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerFlujoDiario({
      desde: "a",
      hasta: "b",
      sucursal: null,
      vendedor: null,
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/reportes/flujo-diario?desde=a&hasta=b",
    );
  });
  it("detalle por vendedor y por día", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerDetalleVendedor({
      fecha: "2026-11-09",
      vendedor: "v1",
      sucursal: null,
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/reportes/flujo-diario/vendedor?fecha=2026-11-09&vendedor=v1",
    );
    await obtenerDetalleDia({
      fecha: "2026-11-09",
      sucursal: "TJ",
      vendedor: null,
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/reportes/flujo-diario/dia?fecha=2026-11-09&sucursal=TJ",
    );
    await obtenerDetalleDia({
      fecha: "2026-11-09",
      sucursal: "TJ",
      vendedor: "v1",
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/reportes/flujo-diario/dia?fecha=2026-11-09&sucursal=TJ&vendedor=v1",
    );
  });
  it("dashboard", async () => {
    apiFetch.mockResolvedValue({});
    await obtenerDashboard(null);
    expect(apiFetch).toHaveBeenLastCalledWith("/dashboard");
    await obtenerDashboard("TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/dashboard?sucursal=TJ");
    await obtenerDetalleDashboard({
      vendedor: "v1",
      sucursal: "MX",
      fecha: "2026-11-09",
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/dashboard/vendedor?vendedor=v1&sucursal=MX&fecha=2026-11-09",
    );
  });
  it("guardarNotasEntregadas: PUT con la fecha y las dos listas, sin cuerpo de respuesta (204)", async () => {
    apiFetchSinCuerpo.mockResolvedValue(undefined);
    const datos = {
      vendedor: "v1",
      fecha: "2026-11-10",
      notas: [{ folio: "TJ1", entregada: true }],
      asignadas: [{ ventaNotaId: "a1", entregada: false }],
    };
    await guardarNotasEntregadas(datos);
    expect(apiFetchSinCuerpo).toHaveBeenCalledWith("/dashboard/notas-entregadas", {
      method: "PUT",
      body: JSON.stringify(datos),
    });
  });
});

describe("fechaRevisable", () => {
  it("hoy y ayer de Tijuana se pueden revisar; antes o después, no", () => {
    expect(fechaRevisable("2026-11-11", "2026-11-11")).toBe(true);
    expect(fechaRevisable("2026-11-10", "2026-11-11")).toBe(true);
    expect(fechaRevisable("2026-11-09", "2026-11-11")).toBe(false);
    expect(fechaRevisable("2026-11-12", "2026-11-11")).toBe(false);
  });

  it("ayer cruza el mes", () => {
    expect(fechaRevisable("2026-10-31", "2026-11-01")).toBe(true);
  });
});
