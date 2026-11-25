import type { Migracion } from './motor';

/**
 * Cambios fisicos y motivo de merma en la tablet (rediseño, pieza 4).
 *
 * - `motivo_merma`: el catalogo que baja en el pull (`motivos_merma`, upsert
 *   generico, baja como bandera), como `motivo_visita` (013). El pull tambien
 *   manda los motivos que solo aplican al almacen: la tablet filtra por
 *   `activo` y por la bandera (`aplica_cliente` / `aplica_vehiculo`).
 * - `movimiento` gana el tipo `cambio` (con cliente, como la merma del cliente),
 *   `motivo_merma_id` (solo en las dos mermas; la app lo exige, las filas viejas
 *   no lo tienen) y `motivo_nombre`, copia del nombre al grabar para pintar sin
 *   join aunque la oficina lo renombre despues.
 *
 * ## Por que se rehace la tabla
 *
 * SQLite no puede cambiar un `check`. Mismo procedimiento que la 010: tabla
 * nueva, copia por nombre, borrar la vieja, renombrar y recrear los indices de
 * la 018, con las llaves foraneas apagadas por el motor. **No** se renombra la
 * vieja para quitarla de en medio: `movimiento_linea` apunta a `movimiento` y
 * SQLite reescribiria su llave para seguir al nombre viejo. Se comprueban
 * `movimiento` (sus llaves a vendedor, cliente y motivo) y `movimiento_linea`
 * (su llave a la tabla rehecha).
 *
 * Los movimientos pendientes de subir se conservan, con su estado y su error.
 *
 * Borra el cursor del pull (como la 019): la primera sincronizacion es completa
 * y trae los motivos sembrados antes de instalar esta version.
 */
export const cambiosMotivoMerma: Migracion = {
  version: 22,
  nombre: 'cambios-motivo-merma',
  sinLlavesForaneas: { comprobar: ['movimiento', 'movimiento_linea'] },
  sql: `
    create table motivo_merma (
      id              text primary key,
      nombre          text not null,
      aplica_cliente  integer not null default 0 check (aplica_cliente in (0, 1)),
      aplica_vehiculo integer not null default 0 check (aplica_vehiculo in (0, 1)),
      activo          integer not null default 1,
      sincronizado_en text not null
    );

    create table movimiento_nueva (
      id              text primary key,           -- = clave de idempotencia
      fecha           text not null,              -- dia de trabajo (fecha_operacion)
      vendedor_id     text not null references vendedor(id),
      cliente_id      text references cliente(id),  -- merma del cliente y cambio
      tipo            text not null
                        check (tipo in ('merma_cliente', 'merma_trayecto', 'consumo', 'cambio')),
      comentario      text,
      motivo_merma_id text references motivo_merma(id),
      motivo_nombre   text,
      registrado_en   text not null,              -- ISO; viaja como ocurrido_en
      sync_estado     text not null default 'pendiente'
                        check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error      text,
      sincronizado_en text,
      check ((tipo in ('merma_cliente', 'cambio')) = (cliente_id is not null)),
      check (motivo_merma_id is null or tipo in ('merma_cliente', 'merma_trayecto')),
      check ((motivo_merma_id is null) = (motivo_nombre is null))
    );

    insert into movimiento_nueva (
      id, fecha, vendedor_id, cliente_id, tipo, comentario, registrado_en,
      sync_estado, sync_error, sincronizado_en
    )
    select
      id, fecha, vendedor_id, cliente_id, tipo, comentario, registrado_en,
      sync_estado, sync_error, sincronizado_en
    from movimiento;

    drop table movimiento;
    alter table movimiento_nueva rename to movimiento;

    -- Los indices no viajan con el \`rename\`: se recrean igual que en 018.
    create index idx_movimiento_sync on movimiento (sync_estado) where sync_estado <> 'sincronizado';
    create index idx_movimiento_vendedor_fecha on movimiento (vendedor_id, fecha);
    create index idx_movimiento_cliente_fecha on movimiento (cliente_id, fecha) where cliente_id is not null;

    delete from sync_cursor where entidad = 'pull';
  `,
};
