/**
 * Rangos de fechas `AAAA-MM-DD` para los atajos de los filtros (UI Etapa 1, spec §4.3).
 * Se cuenta en UTC a medianoche: el día del calendario no depende de la zona del
 * navegador (el equipo desarrolla en Europe/Madrid). "Hoy" lo da `hoyEnTijuana()`
 * (lib/ventas.ts); aquí solo se cuenta a partir de él.
 */

export interface RangoFechas {
  desde: string;
  hasta: string;
}

const MS_DIA = 24 * 60 * 60 * 1000;
const aFecha = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const aIso = (d: Date): string => d.toISOString().slice(0, 10);

/** El día anterior (atajo "Ayer"). */
export function diaAnterior(fecha: string): string {
  const d = aFecha(fecha);
  d.setUTCDate(d.getUTCDate() - 1);
  return aIso(d);
}

/** El día 1 del mes de `fecha`. */
export function primerDiaDelMes(fecha: string): string {
  return `${fecha.slice(0, 8)}01`;
}

/** Lunes a domingo de la semana de `hoy`. */
export function rangoSemana(hoy: string): RangoFechas {
  const d = aFecha(hoy);
  const desdeLunes = (d.getUTCDay() + 6) % 7;
  const lunes = new Date(d.getTime() - desdeLunes * MS_DIA);
  return { desde: aIso(lunes), hasta: aIso(new Date(lunes.getTime() + 6 * MS_DIA)) };
}

/** Del día 1 al último día del mes de `hoy`. */
export function rangoMes(hoy: string): RangoFechas {
  const [anio, mes] = hoy.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0));
  return { desde: primerDiaDelMes(hoy), hasta: aIso(ultimo) };
}
