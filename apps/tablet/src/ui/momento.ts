/**
 * Un momento ISO-8601 (como `sincronizado_en`) en la forma que lee el
 * vendedor: `AAAA-MM-DD HH:mm`, en la hora **local** de la tablet.
 *
 * Local y no UTC por la misma razon que `relojSistema.hoy()` en
 * `src/datos/reloj.ts`: el vendedor vive en la hora de Tijuana. Antes la
 * pantalla mostraba el ISO crudo, `2026-10-10T18:02:54.922Z`, que ademas de
 * ilegible esta en UTC: eran las 11:02 en la tienda.
 *
 * Sin `Intl` a proposito: con `getHours()` y compania no depende de los datos
 * de zona horaria que traiga el motor JS del equipo, y la prueba en Node es
 * determinista.
 *
 * `null` (todavia no se ha bajado nada) y una cadena que no es fecha dicen
 * `nunca`: pintar `NaN-NaN-NaN` seria peor que no decir nada.
 */
export function formatearMomento(iso: string | null): string {
  if (iso === null) return 'nunca';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'nunca';

  const dos = (n: number) => `${n}`.padStart(2, '0');
  const fecha = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  return `${fecha} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** Solo la hora LOCAL, `HH:mm`, para "Cerrado · 10:42" (T-39). `--:--` si no hay. */
export function formatearHora(iso: string | null): string {
  if (iso === null) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const dos = (n: number) => `${n}`.padStart(2, '0');
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Una fecha de calendario `AAAA-MM-DD` (la de una nota o un abono) como la lee el
 * vendedor: `3 nov 2026`. Se lee del texto, sin `Date`: una fecha sin hora no
 * tiene zona y `new Date('2026-11-03')` es medianoche UTC (el 2 en Tijuana).
 * Lo que no tenga esa forma sale tal cual.
 */
export function formatearFechaCorta(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return fecha;
  const mes = MESES_CORTOS[Number(m[2]) - 1];
  const dia = Number(m[3]);
  if (mes === undefined || dia < 1 || dia > 31) return fecha;
  return `${dia} ${mes} ${m[1]}`;
}

/**
 * Un momento ISO como lo pone la nota impresa (pieza 7): `18 nov 2026 · 11:58`,
 * fecha corta y hora en la zona LOCAL de la tablet (Tijuana), con la misma regla
 * que `formatearMomento`. Lo que no sea fecha sale tal cual.
 *
 * Una fecha sin hora (`2026-10-25`: una nota de la oficina, que no tiene hora de
 * venta) sale **solo con el dia**, `25 oct 2026`; `new Date` la leeria como
 * medianoche UTC, el dia anterior en Tijuana (recorrido final, D2).
 */
export function formatearFechaHora(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatearFechaCorta(iso);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dos = (n: number) => `${n}`.padStart(2, '0');
  const fecha = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  return `${formatearFechaCorta(fecha)} · ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
