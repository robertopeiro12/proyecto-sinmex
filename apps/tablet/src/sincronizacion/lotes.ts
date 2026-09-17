/**
 * Troceo de la cola de `push` en lotes que el servidor pueda tragar.
 *
 * Funcion pura y sin globales de plataforma a proposito: corre igual en Hermes
 * (React Native) que en Node, y se prueba sin base ni red. Ver `lotes.spec.ts`.
 */
import { bytesDeTexto } from '@/seguridad/bytes';

import type { OperacionSaliente } from './contrato';

export interface TopesDeLote {
  /** Tope por cantidad. Pasarse es un 400 del servidor. */
  maxOperaciones: number;
  /** Tope por tamano, en bytes del JSON de las operaciones (UTF-8). */
  maxBytes: number;
}

/**
 * Cuanto pesa una operacion en el cable.
 *
 * Se mide en bytes **UTF-8**, que es lo que cuenta el servidor. `String.length`
 * mediria unidades UTF-16 y se quedaria corto con acentos o emojis en
 * `comentarios` — justo el campo largo de una venta.
 *
 * Se usa `bytesDeTexto` (`src/seguridad/bytes.ts`) y no `TextEncoder` por la
 * razon que ese archivo ya documenta: ni React Native ni Hermes garantizan
 * `TextEncoder`, `Buffer`, `btoa` ni `atob` de forma estable entre versiones
 * del SDK. Si esa global faltara, el efecto no seria medir de mas o de menos:
 * reventaria el push entero.
 */
function bytesDe(operacion: OperacionSaliente): number {
  return bytesDeTexto(JSON.stringify(operacion)).length;
}

/**
 * Parte `operaciones` en lotes, respetando el orden y sin perder ninguna.
 *
 * Cierra el lote en curso cuando la siguiente operacion lo haria pasar de
 * `maxOperaciones` o de `maxBytes`, **lo que ocurra primero**. Trocear solo por
 * cantidad no alcanza: 500 ventas caben por cantidad y pesan 218-754 kB, mas de
 * lo que el parser del servidor aceptaba, y ese 413 la tablet lo leia como
 * "sin red" y reenviaba el mismo lote para siempre.
 *
 * Una operacion que ella sola pase de `maxBytes` **va sola en su lote**: se
 * manda y que el servidor decida (su limite es cinco veces mayor). Descartarla
 * seria perder una venta ya capturada, que es peor que un rechazo visible.
 */
export function trocearLotes(
  operaciones: readonly OperacionSaliente[],
  { maxOperaciones, maxBytes }: TopesDeLote,
): OperacionSaliente[][] {
  const lotes: OperacionSaliente[][] = [];
  let actual: OperacionSaliente[] = [];
  let bytes = 0;

  for (const operacion of operaciones) {
    const peso = bytesDe(operacion);
    // El lote vacio acepta la operacion pase lo que pase; de ahi sale la
    // garantia de que una operacion gigante viaja sola en vez de descartarse.
    if (
      actual.length > 0 &&
      (actual.length >= maxOperaciones || bytes + peso > maxBytes)
    ) {
      lotes.push(actual);
      actual = [];
      bytes = 0;
    }
    actual.push(operacion);
    bytes += peso;
  }

  if (actual.length > 0) lotes.push(actual);
  return lotes;
}
