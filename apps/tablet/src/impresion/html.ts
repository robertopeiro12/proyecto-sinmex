/**
 * Los renglones del ticket (`armarTicket`) como la pagina HTML que se manda al
 * dialogo de impresion de Android (rediseno pieza 7).
 *
 * Puro: sin React Native ni `expo-print`, para probarlo con Jest.
 *
 * - Un solo `<pre>` con los renglones unidos por `\n`: respeta los espacios de la
 *   alineacion y los renglones en blanco (un `<div>` por renglon los colapsaria).
 * - Monoespaciado, negro sobre blanco, sin negritas: lo que una termica dibuja.
 * - El ancho va en el propio HTML y no en las opciones de `printAsync`: en
 *   Android el papel lo decide la impresora que se elige en el dialogo, y
 *   `expo-print` solo usa `width` para un primer acomodo. El cuerpo mide el area
 *   imprimible del papel (48 mm en el de 58, 72 mm en el de 80) y la letra se
 *   calcula para que quepan las 32 o 48 columnas.
 */
export type Papel = 58 | 80;

/** Columnas del ticket por papel: lo que recibe `armarTicket`. */
export const COLUMNAS: Record<Papel, 32 | 48> = { 58: 32, 80: 48 };

/** Area imprimible en milimetros (la cabeza termica no llega al borde). */
const IMPRIMIBLE_MM: Record<Papel, number> = { 58: 48, 80: 72 };

/** Ancho de un caracter monoespaciado respecto a su tamano de letra. */
const ANCHO_CARACTER = 0.6;

export function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renglonesAHtml(renglones: string[], papel: Papel): string {
  const anchoMm = IMPRIMIBLE_MM[papel];
  // mm de letra para que COLUMNAS caracteres llenen el area imprimible.
  const letraMm = (anchoMm / (COLUMNAS[papel] * ANCHO_CARACTER)).toFixed(2);
  const cuerpo = renglones.map(escaparHtml).join('\n');
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    `@page { size: ${papel}mm auto; margin: 0; }`,
    'html, body { margin: 0; padding: 0; background: #fff; color: #000; }',
    `.ticket { width: ${anchoMm}mm; margin: 0 auto; padding: 4mm 0; }`,
    `pre { margin: 0; font-family: "Courier New", Courier, monospace; font-size: ${letraMm}mm;`,
    '  line-height: 1.25; font-weight: normal; white-space: pre; overflow: hidden; }',
    '</style></head>',
    `<body><div class="ticket"><pre>${cuerpo}</pre></div></body></html>`,
  ].join('\n');
}
