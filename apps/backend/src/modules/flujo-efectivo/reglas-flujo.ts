/**
 * T-32 — fórmulas del Flujo de Efectivo (spec §3), puras y en centavos.
 * Gastos en 0 hasta que T-30/T-31 (Mario) traigan Compras y Egresos.
 */

export interface FilaVentaDia {
  fecha: string;
  ventasCentavos: number;
}

export interface FilaCobroDia {
  fecha: string;
  repartidor: boolean;
  montoCentavos: number;
}

export interface DiaFlujo {
  fecha: string;
  ventasCentavos: number;
  cobradoRepartidorCentavos: number;
  cobradoOficinaCentavos: number;
  porcentajeCobro: number | null;
}

export interface ResumenFlujo {
  ventasTotalesCentavos: number;
  cobradoRepartidorCentavos: number;
  cobradoOficinaCentavos: number;
  ventasCobradasCentavos: number;
  porcentajeCobro: number | null;
  gastosDisponibles: boolean;
  gastosProduccionCentavos: number;
  gastosOperacionCentavos: number;
  gastosFinancierosCentavos: number;
  utilidadBrutaCentavos: number;
  utilidadOperacionCentavos: number;
  utilidadNetaCentavos: number;
  dias: DiaFlujo[];
}

/** Cobradas / totales × 100 con 1 decimal; null si no hubo ventas (puede pasar de 100). */
export function porcentajeCobro(
  cobradas: number,
  totales: number,
): number | null {
  if (totales === 0) return null;
  return Math.round((cobradas * 1000) / totales) / 10;
}

export function armarResumen(
  ventas: FilaVentaDia[],
  cobros: FilaCobroDia[],
): ResumenFlujo {
  const dias = new Map<string, DiaFlujo>();
  const dia = (fecha: string): DiaFlujo => {
    let d = dias.get(fecha);
    if (!d) {
      d = {
        fecha,
        ventasCentavos: 0,
        cobradoRepartidorCentavos: 0,
        cobradoOficinaCentavos: 0,
        porcentajeCobro: null,
      };
      dias.set(fecha, d);
    }
    return d;
  };

  for (const v of ventas) dia(v.fecha).ventasCentavos += v.ventasCentavos;
  for (const c of cobros) {
    const d = dia(c.fecha);
    if (c.repartidor) d.cobradoRepartidorCentavos += c.montoCentavos;
    else d.cobradoOficinaCentavos += c.montoCentavos;
  }

  const lista = [...dias.values()].sort((a, b) =>
    a.fecha.localeCompare(b.fecha),
  );
  for (const d of lista) {
    d.porcentajeCobro = porcentajeCobro(
      d.cobradoRepartidorCentavos + d.cobradoOficinaCentavos,
      d.ventasCentavos,
    );
  }

  const ventasTotales = lista.reduce((s, d) => s + d.ventasCentavos, 0);
  const repartidor = lista.reduce((s, d) => s + d.cobradoRepartidorCentavos, 0);
  const oficina = lista.reduce((s, d) => s + d.cobradoOficinaCentavos, 0);
  const cobradas = repartidor + oficina;

  // Gastos en 0: T-30/T-31 todavía no los aportan.
  const gastosProduccion = 0;
  const gastosOperacion = 0;
  const gastosFinancieros = 0;
  const utilidadBruta = cobradas - gastosProduccion;
  const utilidadOperacion = utilidadBruta - gastosOperacion;

  return {
    ventasTotalesCentavos: ventasTotales,
    cobradoRepartidorCentavos: repartidor,
    cobradoOficinaCentavos: oficina,
    ventasCobradasCentavos: cobradas,
    porcentajeCobro: porcentajeCobro(cobradas, ventasTotales),
    gastosDisponibles: false,
    gastosProduccionCentavos: gastosProduccion,
    gastosOperacionCentavos: gastosOperacion,
    gastosFinancierosCentavos: gastosFinancieros,
    utilidadBrutaCentavos: utilidadBruta,
    utilidadOperacionCentavos: utilidadOperacion,
    utilidadNetaCentavos: utilidadOperacion - gastosFinancieros,
    dias: lista,
  };
}
