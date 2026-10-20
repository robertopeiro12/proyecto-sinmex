/**
 * Formatos de pantalla del portal (UI Etapa 1, spec §4.5). Antes vivían repartidos
 * (lib/ventas.ts, lib/reportes.ts y dos copias de `plural`); esos archivos los
 * re-exportan para no romper importaciones.
 */

/** Centavos a `$1,234.56`. El signo va antes del $ ("-$50.00"), como se escribe a mano (T-34). */
export function formatearPesos(centavos: number): string {
  const signo = centavos < 0 ? "-" : "";
  return `${signo}$${(Math.abs(centavos) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const FECHA_Y_HORA = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/**
 * `AAAA-MM-DD` → `dd/mm/aaaa`, sin pasar por `Date` (que correría el día). Lo que no
 * tenga esa forma sale tal cual: mejor ver el dato crudo que una fecha inventada.
 */
export function formatearFecha(iso: string): string {
  const m = SOLO_FECHA.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * `AAAA-MM-DD hh:mm` → `dd/mm/aaaa hh:mm`. El servidor ya la manda en hora de Tijuana
 * (`to_char(... at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI')`). Una hora UTC
 * (`...T19:00:00.000Z`) sale tal cual: convertirla aquí sería adivinar la zona.
 */
export function formatearFechaHora(valor: string): string {
  const m = FECHA_Y_HORA.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : valor;
}

/** `plural(3, "venta", "ventas")` → `"3 ventas"`. */
export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** Para el círculo del usuario: "Admin Local" → "AL"; "Roberto" → "RO". */
export function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "?";
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return `${palabras[0][0]}${palabras[1][0]}`.toUpperCase();
}
