/**
 * Inventario por vendedor, sin base ni Nest. La cuenta (teorica, merma teorica,
 * resultados) NO vive aqui: sale de `armarCorte` (`reglas-corte.ts`). Esto solo
 * suma, por presentacion, los cortes ya armados de varios vendedores ("Todos",
 * D3 y D4 de docs/superpowers/specs/2026-11-24-inventario-por-vendedor-design.md).
 */
import {
  compararTamano,
  faltanteDelDia,
  type LineaCorte,
  type TotalesCorte,
} from './reglas-corte';

/**
 * Una presentacion de la suma. `buenas`, `merma`, `faltante` y `resultadoMerma`
 * son `null` si ningun vendedor con corte hecho tuvo esa presentacion (D4).
 */
export type LineaSumada = Omit<LineaCorte, 'buenas' | 'merma'> & {
  buenas: number | null;
  merma: number | null;
};

const CONCEPTOS = [
  'cargadas',
  'vendidas',
  'regaladas',
  'mermaEntregada',
  'mermaRecibida',
  'mermaAlmacen',
  'consumo',
  'cambiosEntregados',
  'cambiosRecibidos',
  'deberiaRegresar',
  'mermaTeorica',
] as const;

/** Los campos que solo cuentan vendedores con el corte hecho. */
const RESULTADOS = ['buenas', 'merma', 'faltante', 'resultadoMerma'] as const;

/**
 * Suma por `presentacionId` los cortes de varios vendedores. Los conceptos del
 * vendedor se suman siempre; lo contado y los resultados, solo de quien tiene
 * el corte hecho (un vendedor sin corte no es 0: no aporta). Orden de
 * `armarCorte`.
 */
export function sumarVendedores(
  cortes: readonly { lineas: readonly LineaCorte[]; hecho: boolean }[],
): {
  lineas: LineaSumada[];
  totales: TotalesCorte;
  vendedoresSinCorte: number;
} {
  const porPresentacion = new Map<string, LineaSumada>();
  for (const corte of cortes) {
    for (const l of corte.lineas) {
      let suma = porPresentacion.get(l.presentacionId);
      if (!suma) {
        suma = {
          presentacionId: l.presentacionId,
          nombre: l.nombre,
          producto: l.producto,
          volumen: l.volumen,
          cargadas: 0,
          vendidas: 0,
          regaladas: 0,
          mermaEntregada: 0,
          mermaRecibida: 0,
          mermaAlmacen: 0,
          consumo: 0,
          cambiosEntregados: 0,
          cambiosRecibidos: 0,
          deberiaRegresar: 0,
          mermaTeorica: 0,
          buenas: null,
          merma: null,
          faltante: null,
          resultadoMerma: null,
        };
        porPresentacion.set(l.presentacionId, suma);
      }
      for (const c of CONCEPTOS) suma[c] += l[c];
      if (!corte.hecho) continue;
      for (const c of RESULTADOS) {
        const valor = l[c];
        if (valor !== null) suma[c] = (suma[c] ?? 0) + valor;
      }
    }
  }

  const lineas = [...porPresentacion.values()].sort(
    (a, b) =>
      compararTamano(a.volumen, b.volumen) ||
      a.producto.localeCompare(b.producto, 'es') ||
      a.presentacionId.localeCompare(b.presentacionId),
  );
  const hayCorte = cortes.some((c) => c.hecho);
  const total = (campo: (typeof CONCEPTOS)[number]) =>
    lineas.reduce((t, l) => t + l[campo], 0);
  const totalCorte = (campo: 'buenas' | 'merma') =>
    lineas.reduce((t, l) => t + (l[campo] ?? 0), 0);
  const totales: TotalesCorte = {
    cargadas: total('cargadas'),
    vendidas: total('vendidas'),
    regaladas: total('regaladas'),
    mermaEntregada: total('mermaEntregada'),
    mermaRecibida: total('mermaRecibida'),
    mermaAlmacen: total('mermaAlmacen'),
    consumo: total('consumo'),
    cambiosEntregados: total('cambiosEntregados'),
    cambiosRecibidos: total('cambiosRecibidos'),
    deberiaRegresar: total('deberiaRegresar'),
    mermaTeorica: total('mermaTeorica'),
    buenas: totalCorte('buenas'),
    merma: totalCorte('merma'),
    faltante: hayCorte
      ? faltanteDelDia(
          lineas.map((l) => ({ volumen: l.volumen, valor: l.faltante })),
        )
      : null,
    faltanteMerma: hayCorte
      ? faltanteDelDia(
          lineas.map((l) => ({ volumen: l.volumen, valor: l.resultadoMerma })),
        )
      : null,
  };
  return {
    lineas,
    totales,
    vendedoresSinCorte: cortes.filter((c) => !c.hecho).length,
  };
}
