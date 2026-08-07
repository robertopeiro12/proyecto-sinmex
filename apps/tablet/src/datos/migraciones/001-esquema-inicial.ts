import type { Migracion } from './motor';

/**
 * Esquema inicial de la base **local** de la tablet.
 *
 * ## Relacion con el esquema de Postgres
 *
 * Los nombres de tabla y columna siguen los de `supabase/migrations/` (T-05)
 * para que la sincronizacion de T-07 sea un mapeo 1:1 y no una traduccion.
 * Las diferencias son deliberadas:
 *
 * - **`id` es `text`, no `uuid`:** SQLite no tiene tipo uuid. Se guarda el uuid
 *   del servidor tal cual (o uno generado local para lo que nace offline).
 * - **El dinero se guarda en centavos (`*_centavos integer`)**, no como
 *   `numeric(12,2)`. SQLite solo tiene `real` para decimales, y un `real` no
 *   suma exacto: el [[Corte de caja]] tiene que cuadrar contra efectivo fisico,
 *   asi que aqui no se usa punto flotante para dinero. La conversion a pesos
 *   ocurre al presentar y al sincronizar.
 * - **Fechas y horas como `text` ISO-8601** (`AAAA-MM-DD` o timestamp completo),
 *   que es lo que SQLite ordena y compara correctamente como texto.
 * - **No hay `deleted_at`:** la tablet no borra logicamente catalogos; recibe un
 *   snapshot completo en cada bajada.
 *
 * ## Campos de sincronizacion (los usaran T-07 y T-43)
 *
 * Hay dos formas segun la direccion del dato:
 *
 * - **Catalogos (bajan del portal, la tablet solo lee):** `sincronizado_en`,
 *   marca de cuando se bajo ese snapshot. Sirve para avisar que los datos estan
 *   viejos (ver "Datos precargados (frescura)" en [[Sincronizacion offline]]).
 * - **Entidades operativas (se capturan offline y suben):** `sync_estado`
 *   (`pendiente` | `enviando` | `sincronizado` | `error`) y
 *   `actualizado_local_en`. Todo lo que se captura nace en `pendiente`.
 *
 * TODO: T-07 — endpoints `pull`/`push` y transiciones de `sync_estado`.
 * TODO: T-14 — tabla de folios y contador diario local (ver ADR-0001).
 * TODO: T-06 — sesion del vendedor valida offline (hoy `vendedor` no guarda
 *       credenciales; solo es el catalogo necesario para abrir la jornada).
 */
export const esquemaInicial: Migracion = {
  version: 1,
  nombre: 'esquema-inicial',
  sql: `
    ------------------------------------------------------------------
    -- Catalogos precargados (bajan del portal antes de salir a ruta)
    ------------------------------------------------------------------

    create table sucursal (
      id                text primary key,
      codigo            text not null unique,
      nombre            text not null,
      activa            integer not null default 1,
      sincronizado_en   text not null
    );

    create table vendedor (
      id                text primary key,
      login             text not null unique,
      nombre            text not null,
      sucursal_id       text not null references sucursal(id),
      activo            integer not null default 1,
      sincronizado_en   text not null
    );

    create table vehiculo (
      id                text primary key,
      nombre            text not null,
      sucursal_id       text not null references sucursal(id),
      activo            integer not null default 1,
      sincronizado_en   text not null
    );

    create table producto (
      id                text primary key,
      nombre            text not null,
      activo            integer not null default 1,
      sincronizado_en   text not null
    );

    create table presentacion (
      id                text primary key,
      producto_id       text not null references producto(id),
      volumen           text not null,
      sincronizado_en   text not null
    );

    create table cliente (
      id                  text primary key,
      nombre              text not null,
      domicilio           text not null,
      telefono            text not null,
      encargado           text,
      tipo                text not null check (tipo in ('cliente', 'prospecto')),
      pct_comision        real,
      promocion           text not null default 'ninguna'
                            check (promocion in ('ninguna', '10+1', '20+1')),
      plazo_credito_dias  integer,
      lat                 real,
      lng                 real,
      sucursal_id         text not null references sucursal(id),
      sincronizado_en     text not null
    );

    create index idx_cliente_sucursal on cliente (sucursal_id, tipo);

    -- Precio ya resuelto POR CLIENTE. El portal maneja listas de precios
    -- historizadas (tabla \`precio\`); la tablet no necesita resolver la lista
    -- vigente en campo, recibe el precio que aplica a cada cliente.
    -- Ver [[Lista de precios]].
    create table cliente_precio (
      id                text primary key,
      cliente_id        text not null references cliente(id),
      presentacion_id   text not null references presentacion(id),
      precio_centavos   integer not null,
      vigente_desde     text not null,
      sincronizado_en   text not null,
      unique (cliente_id, presentacion_id, vigente_desde)
    );

    create index idx_cliente_precio_lookup
      on cliente_precio (cliente_id, presentacion_id, vigente_desde desc);

    ------------------------------------------------------------------
    -- Entidades operativas (se capturan offline y suben al cerrar)
    ------------------------------------------------------------------

    -- La jornada del vendedor: abrir dia (vehiculo + km inicial) y cerrar dia
    -- (km final). Es el registro que bloquea la operacion mientras no exista:
    -- ver "Abrir el dia" en [[App Tablet]].
    create table jornada (
      id                    text primary key,
      fecha                 text not null,
      vendedor_id           text not null references vendedor(id),
      vehiculo_id           text not null references vehiculo(id),
      km_inicial            real not null check (km_inicial >= 0),
      km_final              real check (km_final >= 0),
      abierta_en            text not null,
      cerrada_en            text,
      estado                text not null default 'abierta'
                              check (estado in ('abierta', 'cerrada')),
      sync_estado           text not null default 'pendiente'
                              check (sync_estado in ('pendiente', 'enviando', 'sincronizado', 'error')),
      actualizado_local_en  text not null,
      sincronizado_en       text,
      -- Una sola jornada por vendedor y dia. Es lo que hace que "abrir el dia"
      -- sea idempotente y que reabrir la app no duplique el kilometraje.
      unique (vendedor_id, fecha)
    );

    create index idx_jornada_pendiente on jornada (sync_estado) where sync_estado <> 'sincronizado';
  `,
};
