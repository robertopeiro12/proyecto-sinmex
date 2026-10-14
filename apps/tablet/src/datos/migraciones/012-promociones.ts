import type { Migracion } from './motor';

/**
 * Promociones por regla en la tablet (T-74).
 *
 * - `promocion` la escribe el pull (upsert generico, baja como bandera). La
 *   regla de APLICACION vive en `promociones-reglas.ts`.
 * - `venta_promocion`: que promocion regalo que presentacion en cada venta
 *   local, con la frase congelada; sube en `datos.regalos`.
 * - `cliente.primera_venta_en`: lo marca el servidor (D14) y baja en el pull.
 *
 * La columna `cliente.promocion` (001) se queda: SQLite no la quita sin rehacer
 * la tabla y tiene default, asi que el snapshot simplemente deja de escribirla.
 * Nada la lee desde esta version.
 */
export const promociones: Migracion = {
  version: 12,
  nombre: 'promociones',
  sql: `
    create table promocion (
      id                     text primary key,
      audiencia              text not null check (audiencia in ('todos','cliente','prospecto')),
      cliente_id             text,
      compra_tipo            text not null check (compra_tipo in ('cualquiera','producto','presentacion')),
      compra_producto_id     text,
      compra_presentacion_id text,
      compra_cantidad        integer not null check (compra_cantidad >= 0),
      regalo_tipo            text not null check (regalo_tipo in ('mismo','producto','presentacion')),
      regalo_producto_id     text,
      regalo_presentacion_id text,
      regalo_cantidad        integer not null check (regalo_cantidad >= 1),
      se_repite              integer not null default 1,
      activo                 integer not null default 1,
      sincronizado_en        text not null
    );
    create index idx_promocion_cliente on promocion (cliente_id);

    create table venta_promocion (
      id              text primary key,
      venta_id        text not null references venta(id),
      promocion_id    text not null,
      presentacion_id text not null,
      cantidad        integer not null check (cantidad >= 1),
      texto           text not null
    );
    create index idx_venta_promocion_venta on venta_promocion (venta_id);

    alter table cliente add column primera_venta_en text;
  `,
};
