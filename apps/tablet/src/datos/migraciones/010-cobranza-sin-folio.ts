import type { Migracion } from './motor';

/**
 * La cobranza deja de llevar folio en la base local (T-21).
 *
 * ## Por que
 *
 * Respuesta del cliente (2026-10-07): *"Un solo folio"*, *"Porque la cobranza
 * no lleva folio"*. Solo las ventas se numeran. Hasta aqui la tablet le emitia
 * un folio a cada cobro y gastaba un numero de la serie del vendedor; desde
 * T-21 el repositorio ya no lo emite y el servidor ignora el que llegue.
 *
 * ## Por que se rehace la tabla
 *
 * `ALTER TABLE ... DROP COLUMN` de SQLite no puede quitar una columna `unique`
 * (como era `folio`). Mismo procedimiento que la 005 y la 009: crear la tabla
 * nueva, copiar por nombre, borrar la vieja, renombrar y recrear los indices,
 * con las llaves foraneas apagadas por el motor. Nadie apunta a `cobranza`, asi
 * que la unica tabla que se comprueba es ella misma (sus llaves a `cliente`,
 * `vendedor`, `sucursal` y `nota_pendiente`).
 *
 * **Los cobros pendientes de subir se conservan**: viajan sin folio en el
 * siguiente push, y el servidor los acepta igual.
 */
export const cobranzaSinFolio: Migracion = {
  version: 10,
  nombre: 'cobranza-sin-folio',
  sinLlavesForaneas: { comprobar: ['cobranza'] },
  sql: `
    create table cobranza_nueva (
      id               text primary key,          -- = clave de idempotencia
      fecha            text not null,             -- reloj.hoy(), dia de trabajo
      cliente_id       text not null references cliente(id),
      vendedor_id      text not null references vendedor(id),
      sucursal_id      text not null references sucursal(id),
      venta_nota_id    text not null references nota_pendiente(id),
      monto_centavos   integer not null check (monto_centavos > 0),
      metodo_pago      text not null check (metodo_pago in ('efectivo','transferencia','cheque')),
      fecha_pago       text not null,
      grabada_en       text not null,
      sync_estado      text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error       text,
      sincronizado_en  text
    );

    insert into cobranza_nueva (
      id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id,
      monto_centavos, metodo_pago, fecha_pago, grabada_en, sync_estado,
      sync_error, sincronizado_en
    )
    select
      id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id,
      monto_centavos, metodo_pago, fecha_pago, grabada_en, sync_estado,
      sync_error, sincronizado_en
    from cobranza;

    drop table cobranza;
    alter table cobranza_nueva rename to cobranza;

    -- Los indices no viajan con el \`rename\`: se recrean igual que en 008.
    create index idx_cobranza_sync on cobranza (sync_estado) where sync_estado <> 'sincronizado';
    create index idx_cobranza_cliente_fecha on cobranza (cliente_id, fecha);
  `,
};
