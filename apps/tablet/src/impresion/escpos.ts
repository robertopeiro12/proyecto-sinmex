/**
 * Codificador ESC/POS puro: vuelve los renglones de `armarTicket` en los bytes
 * que recibe la impresora térmica (página de códigos CP850). Sin React ni Expo.
 */

const ESC = 0x1b;
const LF = 0x0a;
/** La PT-210 no corta: se avanza papel para poder arrancar la nota. */
const LF_DE_AVANCE = 4;

/** Los caracteres no ASCII que el ticket usa, en CP850. */
const CP850: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9,
  ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  '¿': 0xa8, '¡': 0xad, '°': 0xf8, '·': 0xfa,
};

function esAsciiImprimible(code: number): boolean {
  return code >= 0x20 && code <= 0x7e;
}

/** Texto -> bytes CP850. Lo que no está en la tabla pierde el acento; si aun así no es ASCII, `?`. */
export function aCp850(texto: string): number[] {
  const salida: number[] = [];
  for (const c of texto) {
    const code = c.codePointAt(0) ?? 0x3f;
    if (esAsciiImprimible(code)) {
      salida.push(code);
      continue;
    }
    const directo = CP850[c];
    if (directo !== undefined) {
      salida.push(directo);
      continue;
    }
    const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const b of base) {
      const bc = b.codePointAt(0) ?? 0x3f;
      salida.push(esAsciiImprimible(bc) ? bc : 0x3f);
    }
  }
  return salida;
}

/** Varios tickets en un solo trabajo: init + CP850, cada renglón con LF y 4 LF tras cada ticket. */
export function ticketsAEscPos(tickets: string[][]): Uint8Array {
  const bytes: number[] = [ESC, 0x40, ESC, 0x74, 0x02];
  for (const ticket of tickets) {
    for (const renglon of ticket) bytes.push(...aCp850(renglon), LF);
    for (let i = 0; i < LF_DE_AVANCE; i++) bytes.push(LF);
  }
  return Uint8Array.from(bytes);
}
