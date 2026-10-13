import type { Migracion } from './motor';

/**
 * La ruta del dia en la tablet (T-37, D15).
 *
 * ## Dos tablas a proposito
 *
 * - `ruta` la escribe el **pull** (y las altas locales del vendedor, que suben
 *   como `ruta-alta`). Es un espejo de las filas del servidor, con la baja como
 *   bandera (`activo = 0`), como los demas catalogos.
 * - `ruta_orden_local` la escribe **solo el dedo del vendedor** al arrastrar. Va
 *   por `(fecha, cliente_id)` y no por el id de la fila, asi que sobrevive a que
 *   el pull funda un alta local con la fila del servidor. Ningun snapshot la
 *   toca: el orden del vendedor no se pierde al refrescar (D4).
 *
 * `uq_ruta_fecha_cliente` es **parcial** (`where activo = 1`): una baja vieja
 * y la fila viva nueva del mismo cliente conviven hasta que el pull limpia la
 * vieja (la oficina lo quito y lo volvio a poner: en el servidor es otra fila).
 *
 * Tabla nueva: no rehace nada, asi que no apaga las llaves foraneas.
 */
export const ruta: Migracion = {
  version: 11,
  nombre: 'ruta',
  sql: `
    create table ruta (
      id              text primary key,          -- id del servidor, o uuid local mientras es alta pendiente
      cliente_id      text not null references cliente(id),
      fecha           text not null,             -- AAAA-MM-DD
      orden           integer not null,          -- el del servidor; en un alta local, el siguiente libre
      origen          text not null check (origen in ('oficina','vendedor')),
      activo          integer not null default 1,
      sync_estado     text not null default 'sincronizada'
                        check (sync_estado in ('sincronizada','pendiente','error')),
      sync_error      text,
      clave           text unique,               -- clave de idempotencia; solo en altas locales
      sincronizado_en text not null
    );
    create unique index uq_ruta_fecha_cliente on ruta (fecha, cliente_id) where activo = 1;

    create table ruta_orden_local (
      fecha      text not null,
      cliente_id text not null,
      posicion   integer not null,
      primary key (fecha, cliente_id)
    );
  `,
};
