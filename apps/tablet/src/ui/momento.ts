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
