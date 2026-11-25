import type { Migracion } from './motor';

/**
 * Rediseño pieza 6 (Corte en la tablet): el corte del vendedor.
 *
 * - **Una fila por jornada** (`jornada_id` unico). Nace como **borrador** en
 *   cuanto el vendedor captura algo (`enviado_en` nulo) y el mismo renglon, con
 *   el mismo `id`, se vuelve el corte **enviado** al cerrar el dia
 *   (`jornadas.cerrarConCorte`, en la misma transaccion que el cierre).
 * - `id` = clave de idempotencia del push (Task 3), como `gasto.id`.
 * - `fecha` y `vendedor_id` se copian de la jornada, no del reloj.
 * - Los `*_json` guardan lo que capturo el vendedor por apartado y, ya enviado,
 *   lo que decia el sistema en ese momento (`repositorios/cortes.ts` documenta
 *   la forma). `cerrados_json` = los apartados que cerro.
 * - `sync_estado` nace `pendiente` tambien en el borrador, pero solo un corte
 *   **enviado** sale en `pendientesDeSincronizar` (filtro por `enviado_en`).
 */
export const corte: Migracion = {
  version: 23,
  nombre: 'corte',
  sql: `
    create table corte (
      id               text primary key,          -- = clave de idempotencia
      jornada_id       text not null unique references jornada(id),
      fecha            text not null,             -- la de la jornada
      vendedor_id      text not null references vendedor(id),
      efectivo_json    text not null default '{}',
      notas_json       text not null default '{}',
      inventario_json  text not null default '{}',
      cerrados_json    text not null default '[]',
      enviado_en       text,                      -- nulo = borrador
      sync_estado      text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error       text,
      sincronizado_en  text
    );

    -- Lo que falta por subir (mismo patron que idx_gasto_sync).
    create index idx_corte_sync on corte (sync_estado)
      where sync_estado <> 'sincronizado' and enviado_en is not null;
    -- "El corte de hoy" del vendedor.
    create index idx_corte_vendedor_fecha on corte (vendedor_id, fecha);
  `,
};
