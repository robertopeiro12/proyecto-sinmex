/**
 * Inventario por vendedor, sin base ni Nest. La cuenta (teorica, merma teorica,
 * resultados) NO vive aqui: sale de `armarCorte` (`reglas-corte.ts`). Esto solo
 * suma, por presentacion, los cortes ya armados de varios vendedores ("Todos",
 * D3 y D4 de docs/superpowers/specs/2026-11-24-inventario-por-vendedor-design.md).
 */
import {
  compararTamano,
  type LineaCorte,
  type TotalesCorte,
} from './reglas-corte';

/**
 * Una presentacion de la suma. La validacion por almacen (`deberiaRegresar`,
 * `buenas`, `faltante`, `mermaTeorica`, `merma`, `resultadoMerma`) es `null` si
 * ningun vendedor con corte hecho tuvo esa presentacion (D3, D4).
 */
export type LineaSumada = Omit<
  LineaCorte,
  'buenas' | 'merma' | 'deberiaRegresar' | 'mermaTeorica'
> & {
  buenas: number | null;
  merma: number | null;
  deberiaRegresar: number | null;
  mermaTeorica: number | null;
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
] as const;

/** La validacion por almacen: solo cuentan vendedores con el corte hecho. */
const RESULTADOS = [
  'deberiaRegresar',
  'mermaTeorica',
  'buenas',
  'merma',
  'faltante',
  'resultadoMerma',
] as const;

/**
 * Suma por `presentacionId` los cortes de varios vendedores. Los conceptos del
 * vendedor se suman siempre; la validacion por almacen (teoricas, lo contado y
 * los resultados), solo de quien tiene el corte hecho (un vendedor sin corte no
 * es 0: no aporta), para que teoricas − reales = resultado cuadre. Con
 * `teoricaSinCorte` (un solo vendedor) las teoricas salen aunque no haya corte.
 * Los faltantes del total son la suma de los de cada corte hecho: lo que sobra
 * a uno no compensa lo que falta a otro (igual que `faltantesDeCortes`).
 */
export function sumarVendedores(
  cortes: readonly {
    lineas: readonly LineaCorte[];
    totales: Pick<TotalesCorte, 'faltante' | 'faltanteMerma'>;
    hecho: boolean;
  }[],
  opciones: { teoricaSinCorte?: boolean } = {},
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
          deberiaRegresar: null,
          mermaTeorica: null,
          buenas: null,
          merma: null,
          faltante: null,
          resultadoMerma: null,
        };
        porPresentacion.set(l.presentacionId, suma);
      }
      for (const c of CONCEPTOS) suma[c] += l[c];
      if (!corte.hecho && opciones.teoricaSinCorte) {
        suma.deberiaRegresar = (suma.deberiaRegresar ?? 0) + l.deberiaRegresar;
        suma.mermaTeorica = (suma.mermaTeorica ?? 0) + l.mermaTeorica;
      }
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
  const totalCorte = (
    campo: 'deberiaRegresar' | 'mermaTeorica' | 'buenas' | 'merma',
  ) => lineas.reduce((t, l) => t + (l[campo] ?? 0), 0);
  const conCorte = cortes.filter((c) => c.hecho);
  const sumaFaltantes = (campo: 'faltante' | 'faltanteMerma') =>
    hayCorte ? conCorte.reduce((t, c) => t + (c.totales[campo] ?? 0), 0) : null;
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
    deberiaRegresar: totalCorte('deberiaRegresar'),
    mermaTeorica: totalCorte('mermaTeorica'),
    buenas: totalCorte('buenas'),
    merma: totalCorte('merma'),
    faltante: sumaFaltantes('faltante'),
    faltanteMerma: sumaFaltantes('faltanteMerma'),
  };
  return {
    lineas,
    totales,
    vendedoresSinCorte: cortes.filter((c) => !c.hecho).length,
  };
}
