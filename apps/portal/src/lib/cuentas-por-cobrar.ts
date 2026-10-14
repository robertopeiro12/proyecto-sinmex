import { apiFetch } from "./api";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./reportes";
import { ETIQUETA_STATUS } from "./ventas";

/*
 * Cuentas por Cobrar (T-22). Misma forma que
 * apps/backend/src/modules/cuentas-cobrar-pagar/reglas-cuentas-por-cobrar.ts
 * (el portal no puede importar del backend). Dinero en centavos enteros.
 */

export interface NotaPorCobrar {
  id: string;
  fecha: string;
  folio: string;
  /** `null` = sin nota de papel. */
  numNota: string | null;
  montoCentavos: number;
  abonadoCentavos: number;
  saldoCentavos: number;
  status: "pendiente" | "abonado";
  /** `null` = el cliente no tiene plazo de crédito. */
  vence: string | null;
  /** 0 = al corriente o sin plazo. */
  diasAtraso: number;
}

export interface ClienteConDeuda {
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  saldoCentavos: number;
  vencidoCentavos: number;
  notas: NotaPorCobrar[];
}

export interface CuentasPorCobrar {
  /** Hoy en Tijuana, según el servidor. */
  hoy: string;
  totalCentavos: number;
  vencidoCentavos: number;
  notas: number;
  clientes: ClienteConDeuda[];
}

export function obtenerCuentasPorCobrar(f: {
  /** Código, `todas`, o null: lo decide el servidor (`resolverAlcance`). */
  sucursal: string | null;
  soloVencidas: boolean;
}): Promise<CuentasPorCobrar> {
  const q = new URLSearchParams();
  if (f.sucursal) q.set("sucursal", f.sucursal);
  if (f.soloVencidas) q.set("soloVencidas", "true");
  const consulta = q.toString();
  return apiFetch<CuentasPorCobrar>(`/cuentas-por-cobrar${consulta ? `?${consulta}` : ""}`);
}

/** "Sin plazo", "25/10/2026 · Al corriente" o "28/09/2026 · 16 días". */
export function textoVence(n: { vence: string | null; diasAtraso: number }): string {
  if (n.vence === null) return "Sin plazo";
  const fecha = formatearFecha(n.vence);
  if (n.diasAtraso <= 0) return `${fecha} · Al corriente`;
  return `${fecha} · ${n.diasAtraso} ${n.diasAtraso === 1 ? "día" : "días"}`;
}

/** Cobranza abre directo ese cliente con esa nota marcada (T-22, criterio 3). */
export function enlaceCobrar(clienteId: string, notaId: string, sucursal: string | null): string {
  const q = new URLSearchParams({ cliente: clienteId, nota: notaId });
  if (sucursal) q.set("sucursal", sucursal);
  return `/operacion/cobranza?${q.toString()}`;
}

const pesos = (centavos: number): number => centavos / 100;

/** Lo que está en pantalla como hoja de Excel, una fila por nota. */
export function definicionExcelCuentasPorCobrar(
  datos: CuentasPorCobrar,
  filtros: { sucursal: string; soloVencidas: boolean },
): DefinicionExcel {
  const filas: FilaExcel[] = [];
  let monto = 0;
  let abonado = 0;
  for (const c of datos.clientes) {
    for (const n of c.notas) {
      monto += n.montoCentavos;
      abonado += n.abonadoCentavos;
      filas.push({
        celdas: [
          c.cliente,
          c.sucursalCodigo,
          n.fecha,
          n.folio,
          n.numNota ?? "",
          pesos(n.montoCentavos),
          pesos(n.abonadoCentavos),
          pesos(n.saldoCentavos),
          ETIQUETA_STATUS[n.status],
          n.vence ?? "Sin plazo",
          n.diasAtraso,
        ],
        resaltada: n.diasAtraso > 0,
      });
    }
  }
  filas.push({
    tipo: "total",
    celdas: ["Total", null, null, null, null, pesos(monto), pesos(abonado), pesos(datos.totalCentavos), null, null, null],
  });

  const archivoSucursal = filtros.sucursal === "Todas" ? "todas" : filtros.sucursal;
  return {
    titulo: "Cuentas por Cobrar",
    filtros: [
      ["Fecha", formatearFecha(datos.hoy)],
      ["Sucursal", filtros.sucursal],
      ["Notas", filtros.soloVencidas ? "Solo vencidas" : "Todas"],
    ],
    columnas: [
      { encabezado: "Cliente", tipo: "texto", ancho: 30 },
      { encabezado: "Sucursal", tipo: "texto", ancho: 10 },
      { encabezado: "Fecha", tipo: "fecha", ancho: 12 },
      { encabezado: "Folio", tipo: "texto", ancho: 16 },
      { encabezado: "# nota", tipo: "texto", ancho: 10 },
      { encabezado: "Total", tipo: "pesos", ancho: 14 },
      { encabezado: "Abonado", tipo: "pesos", ancho: 14 },
      { encabezado: "Saldo", tipo: "pesos", ancho: 14 },
      { encabezado: "Status", tipo: "texto", ancho: 12 },
      { encabezado: "Vence", tipo: "fecha", ancho: 12 },
      { encabezado: "Días de atraso", tipo: "numero", ancho: 15 },
    ],
    filas,
    nombreArchivo: `cuentas-por-cobrar-${archivoSucursal}-${datos.hoy}`,
  };
}
