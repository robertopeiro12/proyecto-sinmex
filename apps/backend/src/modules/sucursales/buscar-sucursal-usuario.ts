import type { Database } from '../../database/database.tokens';

/**
 * La sucursal del usuario. Distingue tres casos que NO se pueden colapsar:
 *   - `undefined`                  -> el usuario no existe o esta dado de baja
 *   - `{ id: null, codigo: null }` -> existe y es General
 *   - `{ id: '…', codigo: 'TJ' }`  -> existe y esta atado a Tijuana
 * Devolver null para los dos primeros convertiria a un usuario borrado en
 * uno con acceso a todas las sucursales.
 *
 * Extraida en T-12 (D9 del plan): vivia duplicada en `VehiculosRepository`
 * (T-11) y `PreciosRepository` (T-18), cada una con su propio comentario
 * anotando que la duplicacion era a proposito "hasta la cuarta copia".
 * `ClientesRepository` es esa cuarta copia, asi que se extrae ahora en vez de
 * triplicarla y luego cuadruplicarla el mismo dia. Hoy la usan
 * `ClientesRepository`, `VehiculosRepository` y `PreciosRepository`.
 *
 * Es una funcion plana (no un servicio de Nest inyectable) porque no tiene
 * estado propio: recibe la conexion como parametro, igual que `aNumero()` de
 * `sincronizacion/dinero.ts`.
 */
export async function buscarSucursalUsuario(
  db: Database,
  usuarioId: string,
): Promise<{ id: string | null; codigo: string | null } | undefined> {
  return db
    .selectFrom('usuario')
    .leftJoin('sucursal', 'sucursal.id', 'usuario.sucursal_id')
    .select(['sucursal.id as id', 'sucursal.codigo as codigo'])
    .where('usuario.id', '=', usuarioId)
    .where('usuario.deleted_at', 'is', null)
    .executeTakeFirst();
}
