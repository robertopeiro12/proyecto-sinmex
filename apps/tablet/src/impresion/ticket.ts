import type { FechaISO, MomentoISO } from '@/datos/tipos';
import { formatearFechaCorta, formatearFechaHora } from '@/ui/momento';
import { pesos } from '@/ui/pesos';

/**
 * La nota impresa (rediseño pieza 7, spec §12, maquetas 25-27) como renglones de
 * texto de ancho fijo: 32 columnas en papel de 58 mm, 48 en el de 80 mm.
 *
 * Es el contrato que consume el controlador de la impresora: cada renglón cabe en
 * `columnas`, no lleva espacios al final y solo usa texto (sin negritas ni tamaños;
 * el "estado en grande" es un renglón centrado entre marcas `***`).
 *
 * Reglas de acomodo:
 * - Un renglón "etiqueta ... valor" alinea el valor a la derecha; si no cabe, se
 *   corta el valor (un nombre largo de cliente, de quien atendió o del vendedor).
 * - La tabla es `Cant Producto P.U. Importe`. Ni el dinero ni el nombre del producto
 *   se pierden: primero se arma la parte numérica de la derecha, el nombre ocupa lo
 *   que sobre en ese renglón (a 32 columnas, 13 caracteres, cortado por palabras) y
 *   el resto sigue en renglones de abajo, sangrados y sin montos. Un precio o
 *   importe más ancho que su columna recorre ese renglón a la izquierda y le quita
 *   espacio al nombre.
 * - La frase de la promoción y el aviso "Detalle no disponible…" se cortan por
 *   palabras.
 * - La LIQUIDADA no lleva espacio de firma (plan, decisión 3).
 */
export interface DatosTicket {
  sucursal: string;
  folio: string;
  momento: MomentoISO;
  cliente: string;
  atendio: string | null;
  vendedor: string;
  renglones: { cantidad: number; etiqueta: string; precioCentavos: number; importeCentavos: number }[];
  promociones: { cantidad: number; etiqueta: string; texto: string }[];
  totalCentavos: number;
  abonos: { fecha: FechaISO; montoCentavos: number }[];
  saldoCentavos: number;
  reimpresion: { momento: MomentoISO; cobro: string } | null;
  /** `false` para una nota de otra tablet que bajó sin renglones (pull viejo). */
  detalleDisponible: boolean;
}

export type EstadoTicket = 'LIQUIDADA' | 'ABONADO' | 'CRÉDITO';

/** Saldo 0 primero: una venta solo de promoción (total 0, sin abonos) es LIQUIDADA. */
export function estadoTicket(d: DatosTicket): EstadoTicket {
  if (d.saldoCentavos <= 0) return 'LIQUIDADA';
  if (d.abonos.length === 0 && d.saldoCentavos === d.totalCentavos) return 'CRÉDITO';
  return 'ABONADO';
}

const ANCHO_CANT = 4;
const ANCHO_PU = 5;
const ANCHO_IMPORTE = 7;
const SANGRIA_PROMO = ANCHO_CANT + 1;

/** NFC para que una "é" descompuesta no cuente como dos columnas. */
const texto = (s: string) => s.normalize('NFC');

/** Sin signo de pesos, para la tabla: `216.00`, `1,234.56`. */
const monto = (centavos: number) => pesos(centavos).replace('$', '');

function centrado(s: string, columnas: number): string {
  const t = texto(s).slice(0, columnas).trimEnd();
  return ' '.repeat(Math.floor((columnas - t.length) / 2)) + t;
}

function parValor(etiqueta: string, valor: string, columnas: number): string {
  const e = texto(etiqueta);
  const v = texto(valor).slice(0, Math.max(0, columnas - e.length - 1)).trimEnd();
  return e + ' '.repeat(Math.max(1, columnas - e.length - v.length)) + v;
}

/** Corta por palabras; una palabra más ancha que el renglón se parte a la fuerza. */
function porPalabras(s: string, ancho: number): string[] {
  const salida: string[] = [];
  let actual = '';
  for (let palabra of texto(s).split(/\s+/).filter(Boolean)) {
    while (palabra.length > ancho) {
      if (actual) salida.push(actual);
      actual = '';
      salida.push(palabra.slice(0, ancho));
      palabra = palabra.slice(ancho);
    }
    if (!palabra) continue;
    if (!actual) actual = palabra;
    else if (actual.length + 1 + palabra.length <= ancho) actual += ` ${palabra}`;
    else {
      salida.push(actual);
      actual = palabra;
    }
  }
  if (actual) salida.push(actual);
  return salida;
}

/**
 * Un renglón de la tabla. El nombre del producto **nunca** se pierde: el primer
 * renglón lleva cantidad, lo que quepa del nombre (cortado por palabras), P.U. e
 * importe; el resto del nombre sigue abajo, sangrado como la frase de la promoción
 * y sin montos.
 */
function renglonesTabla(cant: string, nombre: string, pu: string, importe: string, columnas: number): string[] {
  const izquierda = cant.padStart(ANCHO_CANT) + ' ';
  const derecha = ` ${pu.padStart(ANCHO_PU)} ${importe.padStart(ANCHO_IMPORTE)}`;
  const ancho = Math.max(0, columnas - izquierda.length - derecha.length);
  const completo = texto(nombre).split(/\s+/).filter(Boolean).join(' ');
  const primero = ancho > 0 ? (porPalabras(completo, ancho)[0] ?? '') : '';
  const resto = completo.slice(primero.length).trim();
  return [
    (izquierda + primero.padEnd(ancho) + derecha).slice(-columnas),
    ...porPalabras(resto, columnas - SANGRIA_PROMO).map((l) => ' '.repeat(SANGRIA_PROMO) + l),
  ];
}

export function armarTicket(d: DatosTicket, columnas: 32 | 48): string[] {
  const separador = '-'.repeat(columnas);
  const estado = estadoTicket(d);
  const r: string[] = [
    centrado('JAWA', columnas),
    centrado(d.sucursal, columnas),
    centrado('NOTA DE VENTA', columnas),
    parValor('Folio', d.folio, columnas),
    parValor('Fecha', formatearFechaHora(d.momento), columnas),
    separador,
    parValor('Cliente', d.cliente, columnas),
  ];
  if (d.atendio !== null && d.atendio.trim() !== '') r.push(parValor('Atendió', d.atendio, columnas));
  r.push(parValor('Vendedor', d.vendedor, columnas), separador);

  if (d.detalleDisponible) {
    r.push(
      `${'Cant'.padEnd(ANCHO_CANT)} ${'Producto'.padEnd(columnas - SANGRIA_PROMO - ANCHO_PU - ANCHO_IMPORTE - 2)} ${'P.U.'.padStart(ANCHO_PU)} Importe`,
    );
    for (const x of d.renglones) {
      r.push(...renglonesTabla(String(x.cantidad), x.etiqueta, monto(x.precioCentavos), monto(x.importeCentavos), columnas));
    }
    for (const p of d.promociones) {
      r.push(...renglonesTabla(String(p.cantidad), p.etiqueta, 'PROMO', monto(0), columnas));
      for (const l of porPalabras(p.texto, columnas - SANGRIA_PROMO)) r.push(' '.repeat(SANGRIA_PROMO) + l);
    }
    r.push(separador);
    const piezas = [...d.renglones, ...d.promociones].reduce((s, x) => s + x.cantidad, 0);
    r.push(parValor('Piezas', String(piezas), columnas));
  } else {
    // Sin renglones no hay piezas que contar: un 0 diría algo falso.
    r.push(...porPalabras('Detalle no disponible en esta tablet', columnas), separador);
  }
  r.push(parValor('TOTAL', pesos(d.totalCentavos), columnas));

  if (estado === 'LIQUIDADA') {
    r.push(
      parValor('Pagó', pesos(d.totalCentavos), columnas),
      parValor('Saldo pendiente', pesos(0), columnas),
    );
  } else {
    r.push(separador);
    if (d.abonos.length > 0) {
      r.push('Abonos');
      for (const a of d.abonos) r.push(parValor(formatearFechaCorta(a.fecha), pesos(a.montoCentavos), columnas));
    }
    r.push(parValor('SALDO PENDIENTE', pesos(d.saldoCentavos), columnas));
  }

  r.push('', centrado(`*** ${estado} ***`, columnas), '');

  if (d.reimpresion) {
    r.push(
      parValor('Reimpresión', formatearFechaHora(d.reimpresion.momento), columnas),
      parValor('Cobró', d.reimpresion.cobro, columnas),
    );
  }

  if (estado !== 'LIQUIDADA') {
    r.push(separador, '', '', '', centrado('_'.repeat(columnas - 8), columnas), centrado('Firma de quien recibe', columnas));
  }

  if (r[r.length - 1] !== '') r.push('');
  r.push(centrado('Gracias por su compra', columnas));
  return r;
}
