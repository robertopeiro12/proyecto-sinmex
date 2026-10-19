/**
 * Las reglas del gasto que comparten el repositorio (`repositorios/gastos.ts`)
 * y la logica pura de la pantalla (`src/estado/gasto.ts`): una sola fuente de
 * verdad, para que el tope no se escriba dos veces. Son los mismos topes que el
 * servidor (`compras-egresos/datos-gasto.ts`).
 */
export const LARGO_MAX_COMENTARIO_GASTO = 200;
export const MAX_MONTO_GASTO_CENTAVOS = 999_999_999_999;

/** Entero de centavos, de 1 al tope. */
export function montoGastoValido(centavos: number): boolean {
  return Number.isSafeInteger(centavos) && centavos >= 1 && centavos <= MAX_MONTO_GASTO_CENTAVOS;
}
