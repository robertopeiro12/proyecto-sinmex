/**
 * Conversion de dinero entre Postgres y la tablet.
 *
 * Postgres guarda `numeric(12,2)` y el driver `pg` lo entrega como **cadena**
 * (`"10.50"`), no como numero — a proposito: un `numeric` no cabe siempre en un
 * `double`. La tablet, en cambio, guarda **centavos enteros**
 * ([[ADR-0004 Capa de datos local de la tablet]]) porque el [[Corte de caja]]
 * cuadra contra efectivo fisico y un centavo de diferencia dispara el flujo de
 * "se le carga al repartidor".
 *
 * Asi que la frontera esta aqui, en una funcion con pruebas, y no repartida en
 * `Number(x) * 100` por el codigo: `10.10 * 100` da `1010.0000000000001` en
 * coma flotante, y redondear "casi siempre bien" es exactamente el tipo de
 * error que aparece a los seis meses en un corte descuadrado.
 */

/**
 * Pasa un `numeric` de Postgres a centavos enteros, **sin punto flotante**.
 *
 * Trabaja sobre el texto: parte por el punto decimal y compone el entero. Un
 * `numeric(12,2)` nunca trae mas de 2 decimales, pero si llegara alguno mas
 * (una columna con otra escala) se redondea al centavo mas cercano en vez de
 * truncar en silencio.
 */
export function aCentavos(valor: string | number | null | undefined): number {
  if (valor === null || valor === undefined) return 0;

  const texto = typeof valor === 'number' ? valor.toString() : valor.trim();
  if (texto === '') return 0;

  const signo = texto.startsWith('-') ? -1 : 1;
  const sinSigno = texto.replace(/^[+-]/, '');

  if (!/^\d*(\.\d*)?$/.test(sinSigno)) {
    throw new TypeError(`No es un importe valido: ${JSON.stringify(valor)}`);
  }

  const [entera = '0', decimal = ''] = sinSigno.split('.');

  // Se lee un decimal de mas para poder redondear el ultimo centavo.
  const centavos = (decimal + '000').slice(0, 2);
  const siguiente = Number((decimal + '000')[2]);

  const total =
    Number(entera || '0') * 100 + Number(centavos) + (siguiente >= 5 ? 1 : 0);

  return signo * total;
}

/**
 * Centavos → cadena `numeric` para escribir en Postgres.
 *
 * Devuelve texto y no un numero por la misma razon por la que `pg` lo entrega
 * como texto: es lo unico que atraviesa la frontera sin perder exactitud.
 *
 * TODO: T-16/T-20 — la usaran al proyectar las ventas y la cobranza que hoy
 *       solo se guardan en `sync_operacion`.
 */
export function aPesos(centavos: number): string {
  if (!Number.isInteger(centavos)) {
    throw new TypeError(`Los centavos deben ser enteros: ${centavos}`);
  }
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const entera = Math.floor(absoluto / 100);
  const decimal = (absoluto % 100).toString().padStart(2, '0');
  return `${signo}${entera}.${decimal}`;
}

/** `numeric` de Postgres a numero JS. Para porcentajes y coordenadas, no dinero. */
export function aNumero(
  valor: string | number | null | undefined,
): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(numero) ? numero : null;
}
