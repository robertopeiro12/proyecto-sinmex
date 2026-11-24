import type { MomentoISO } from '@/datos/tipos';

/** "hace 12 min" / "hace 2 h" para el pie del menú; `null` es que nunca bajó nada. */
export function textoHaceCuanto(desde: MomentoISO | null, ahora: MomentoISO): string {
  if (desde === null) return 'nunca';
  const minutos = Math.floor((Date.parse(ahora) - Date.parse(desde)) / 60000);
  if (!(minutos >= 1)) return 'hace un momento';
  if (minutos < 60) return `hace ${minutos} min`;
  return `hace ${Math.floor(minutos / 60)} h`;
}

export function textoSinSincronizar(n: number): string {
  return n === 0 ? 'Todo sincronizado' : `${n} sin sincronizar`;
}
