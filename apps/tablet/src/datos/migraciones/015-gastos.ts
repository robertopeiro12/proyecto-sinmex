import type { Migracion } from './motor';

/**
 * Los gastos de la ruta en la tablet (T-30/T-31, D8).
 *
 * - `campo_egreso`: el catalogo que baja en el pull (`campos_egreso`, upsert
 *   generico, baja como bandera). La pantalla Gastos ofrece solo los activos con
 *   `se_usa_en_app = 1` (`camposParaGasto`, `src/estado/gasto.ts`). `tipo` va sin
 *   check a proposito: si el servidor agrega uno, un check aqui haria fallar el
 *   upsert del snapshot entero (mismo criterio que `cliente.ubicacion_origen`).
 * - `gasto`: lo que el vendedor paga con la cobranza del dia. `id` = clave de
 *   idempotencia y, en el servidor, el id de la fila (D4). `campo_nombre` es una
 *   copia del nombre al guardar, para pintar sin join aunque la oficina lo
 *   renombre despues. No se edita ni se borra en la app (D9).
 * - La foto del ticket usa el **mismo esquema derivado** que la de la visita
 *   (013): `foto_local` + `foto_subida_en` + `foto_error` + `foto_descartada`.
 *   Ninguna toca `sync_estado`: una foto que falla no se lleva el gasto.
 */
export const gastos: Migracion = {
  version: 15,
  nombre: 'gastos',
  sql: `
    create table campo_egreso (
      id              text primary key,
      nombre          text not null,
      tipo            text not null,
      se_usa_en_app   integer not null default 0 check (se_usa_en_app in (0, 1)),
      activo          integer not null default 1,
      sincronizado_en text not null
    );

    create table gasto (
      id               text primary key,           -- = clave de idempotencia
      fecha            text not null,              -- dia de trabajo (fecha_operacion)
      vendedor_id      text not null references vendedor(id),
      sucursal_id      text not null references sucursal(id),
      campo_egreso_id  text not null references campo_egreso(id),
      campo_nombre     text not null,
      monto_centavos   integer not null check (monto_centavos > 0),
      comentario       text,
      registrado_en    text not null,              -- ISO; viaja como ocurrido_en
      foto_local       text,
      foto_subida_en   text,
      foto_error       text,
      foto_descartada  integer not null default 0 check (foto_descartada in (0, 1)),
      sync_estado      text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error       text,
      sincronizado_en  text
    );

    -- Lo que falta por subir (mismo patron que idx_visita_sync).
    create index idx_gasto_sync on gasto (sync_estado) where sync_estado <> 'sincronizado';
    -- "Gastos de hoy" y su total.
    create index idx_gasto_vendedor_fecha on gasto (vendedor_id, fecha);
    -- La cola de fotos, como idx_visita_foto_pendiente (013).
    create index idx_gasto_foto_pendiente on gasto (sync_estado)
      where foto_local is not null and foto_subida_en is null and foto_descartada = 0;
  `,
};
