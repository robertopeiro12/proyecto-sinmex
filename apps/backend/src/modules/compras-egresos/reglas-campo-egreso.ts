import { hoyEnTijuana } from '../sincronizacion/operaciones';

/**
 * El 1 de enero del año en curso **en Tijuana** (`AAAA-01-01`), para la regla
 * de baja del campo (T-30, D2): "no se puede eliminar hasta el siguiente año".
 *
 * El año sale del dia de Tijuana y no del de UTC: el 31 de diciembre a las
 * 23:30 de Tijuana en UTC ya es el año siguiente, y la baja se colaria un rato
 * antes de tiempo.
 */
export function inicioDelAnioEnTijuana(ahora: Date): string {
  return `${hoyEnTijuana(ahora).slice(0, 4)}-01-01`;
}
