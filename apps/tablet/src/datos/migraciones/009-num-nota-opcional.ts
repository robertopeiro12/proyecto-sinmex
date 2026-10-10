import type { Migracion } from './motor';

/**
 * El # de la nota fisica deja de ser obligatorio en la base local.
 *
 * ## Por que
 *
 * Respuesta del cliente (2026-10-06): el block de papel **solo se usa cuando
 * falla el sistema**, y lo que les interesa es el folio que genera el sistema.
 * En una venta normal no hay nota de papel, asi que no hay numero que capturar.
 * Postgres lo relajo en `20261007120000_venta_num_nota_opcional.sql`.
 *
 * ## Las dos tablas
 *
 * - **`venta`** (004): para poder grabar una venta sin numero. Un numero en
 *   blanco sigue sin entrar: "sin nota" es `null`, no `''`.
 * - **`nota_pendiente`** (002): para poder **recibir** una nota sin numero en
 *   el `pull`. Es el mismo riesgo que corrigio la 005 con `cliente.domicilio`:
 *   con la columna `not null`, el `insert` del snapshot revienta, y como se
 *   aplica en una sola transaccion, **la tablet dejaria de sincronizar del
 *   todo** en cuanto alguien registre una venta sin nota en su sucursal.
 *
 * ## Por que se rehacen
 *
 * `ALTER TABLE` de SQLite no sabe quitar un `not null`; mismo procedimiento
 * que la 005 (crear, copiar por nombre, borrar, renombrar, recrear indices),
 * con las llaves foraneas apagadas por el motor. Las hijas que se comprueban
 * antes del commit son `venta_linea` (-> `venta`) y `cobranza`
 * (-> `nota_pendiente`).
 */
export const numNotaOpcional: Migracion = {
  version: 9,
  nombre: 'num-nota-opcional',
  sinLlavesForaneas: { comprobar: ['venta_linea', 'cobranza'] },
  sql: `
    create table venta_nueva (
      id                   text primary key,          -- = clave de idempotencia
      fecha                text not null,             -- reloj.hoy(), dia de trabajo
      cliente_id           text not null references cliente(id),
      vendedor_id          text not null references vendedor(id),
      sucursal_id          text not null references sucursal(id),
      folio                text not null unique,
      -- Nulo si no hubo nota de papel (lo normal).
      num_nota             text check (num_nota is null or length(trim(num_nota)) > 0),
      contado_credito      text not null check (contado_credito in ('contado','credito')),
      factura              text not null default 'N/A' check (factura in ('N/A','pendiente')),
      comentarios          text,
      monto_total_centavos integer not null check (monto_total_centavos >= 0),
      grabada_en           text not null,
      sync_estado          text not null default 'pendiente'
                             check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error           text,
      sincronizado_en      text
    );

    insert into venta_nueva (
      id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
      contado_credito, factura, comentarios, monto_total_centavos, grabada_en,
      sync_estado, sync_error, sincronizado_en
    )
    select
      id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
      contado_credito, factura, comentarios, monto_total_centavos, grabada_en,
      sync_estado, sync_error, sincronizado_en
    from venta;

    drop table venta;
    alter table venta_nueva rename to venta;

    -- Los indices no viajan con el \`rename\`: se recrean igual que en 004.
    create index idx_venta_sync on venta (sync_estado) where sync_estado <> 'sincronizado';
    create index idx_venta_cliente_fecha on venta (cliente_id, fecha);

    create table nota_pendiente_nueva (
      id                    text primary key,
      cliente_id            text not null references cliente(id),
      folio                 text not null,
      -- Nulo si la venta no tuvo nota de papel (lo normal).
      num_nota              text,
      fecha                 text not null,
      status                text not null check (status in ('pendiente', 'abonado')),
      monto_total_centavos  integer not null,
      saldo_centavos        integer not null,
      activo                integer not null default 1,
      sincronizado_en       text not null,
      abonos_json           text not null default '[]'
    );

    insert into nota_pendiente_nueva (
      id, cliente_id, folio, num_nota, fecha, status, monto_total_centavos,
      saldo_centavos, activo, sincronizado_en, abonos_json
    )
    select
      id, cliente_id, folio, num_nota, fecha, status, monto_total_centavos,
      saldo_centavos, activo, sincronizado_en, abonos_json
    from nota_pendiente;

    drop table nota_pendiente;
    alter table nota_pendiente_nueva rename to nota_pendiente;

    -- Igual que en 002.
    create index idx_nota_pendiente_cliente on nota_pendiente (cliente_id, activo);
  `,
};
