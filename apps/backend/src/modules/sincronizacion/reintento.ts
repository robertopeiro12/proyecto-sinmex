import { esConflictoDeConcurrencia } from '../../database/errores-postgres';

/**
 * Cuantas veces se ejecuta, como maximo, la transaccion de UNA operacion del
 * `push` cuando Postgres la elige victima de un deadlock (T-16, Task 8b).
 *
 * Dos reintentos simultaneos del mismo lote insertan la misma fila del buzon,
 * que choca a la vez en `(vendedor_id, clave_idempotencia)` y en
 * `uq_sync_operacion_folio`. A veces Postgres no hace esperar a una: detecta un
 * deadlock, aborta una de las dos y deja terminar a la otra. Al repetirse, la
 * victima ya ve la fila confirmada y cae en `on conflict do nothing`
 * (`duplicada`) o en la colision de folio, que se desempata mirando la clave.
 * Tres intentos cubren la contencion de dos o tres reintentos solapados sin
 * esconder un bucle: si el tercero tambien choca, algo mas esta mal y sale 500.
 */
export const INTENTOS_ANTE_CONFLICTO = 3;

/**
 * Ejecuta `tarea` y la repite desde el principio si falla por un conflicto de
 * concurrencia, hasta `INTENTOS_ANTE_CONFLICTO` veces.
 *
 * `tarea` tiene que abrir su propia transaccion en cada llamada: repetir
 * consultas sobre una transaccion ya abortada fallaria igual. Cualquier otro
 * error sale en el primer intento, tal cual.
 */
export async function reintentarAnteConflicto<T>(
  tarea: () => Promise<T>,
): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await tarea();
    } catch (error) {
      if (intento >= INTENTOS_ANTE_CONFLICTO) throw error;
      if (!esConflictoDeConcurrencia(error)) throw error;
    }
  }
}
