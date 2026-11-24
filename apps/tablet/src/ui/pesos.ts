/**
 * Formatea centavos enteros como pesos.
 *
 * El dinero vive en **centavos enteros** en toda la app (ver `ADR-0004`:
 * SQLite no tiene `numeric` y el corte de caja cuadra contra efectivo fisico).
 * Esta es la unica frontera donde eso se vuelve texto, para que nadie divida
 * entre 100 por su cuenta en una pantalla.
 *
 * Vive en un `.ts` (y no en `cifra.tsx`, que lo reexporta) para que la logica
 * pura de `src/estado/` lo use y Jest lo cargue.
 */
export function pesos(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const enteros = Math.floor(abs / 100).toLocaleString('es-MX');
  const dec = String(abs % 100).padStart(2, '0');
  return `${signo}$${enteros}.${dec}`;
}
