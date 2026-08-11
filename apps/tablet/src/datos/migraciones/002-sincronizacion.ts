import type { Migracion } from './motor';

/**
 * Lo que la sincronizacion de T-07 necesita en la base local.
 *
 * Tres cosas:
 *
 * ## 1. `activo` en los catalogos que no lo tenian
 *
 * Es la **politica de purga** que T-04 dejo abierta. El snapshot se aplica con
 * upsert y no con reemplazo (ver `catalogos.ts`: borrar revienta la llave
 * foranea cuando la jornada ya esta abierta, que es justo el momento del
 * refresco de media manana), asi que una fila que desapareciera del snapshot se
 * quedaria aqui para siempre.
 *
 * La salida es que **la baja viaja como bandera**: el portal nunca borra fisico
 * (`deleted_at`), asi que dar de baja es un `update` y la fila llega en el pull
 * incremental con `activo: 0`. La tablet la refleja y deja de ofrecerla, sin
 * borrar nada que la operacion local todavia referencie.
 *
 * `sucursal`, `vendedor`, `vehiculo` y `producto` ya traian la columna desde
 * T-04; faltaban `cliente`, `presentacion` y `cliente_precio`.
 *
 * ## 2. `nota_pendiente`
 *
 * Las notas por cobrar que el vendedor selecciona al cobrar/abonar en campo
 * (ver [[App Tablet]], "Cobranza / abono"). Bajan del portal como los
 * catalogos, no se capturan aqui.
 *
 * TODO: T-20 — el modulo de cobranza escribira los abonos y descontara el saldo
 *       localmente; hoy la tabla solo se lee.
 *
 * ## 3. `sync_cursor` y `jornada.sync_error`
 *
 * El cursor del pull incremental (una fila, `entidad = 'pull'`) y el motivo por
 * el que el servidor rechazo una operacion. Sin el motivo, una jornada en
 * `sync_estado = 'error'` seria un callejon sin salida: nadie sabria por que ni
 * podria decirselo al vendedor.
 */
export const sincronizacion: Migracion = {
  version: 2,
  nombre: 'sincronizacion',
  sql: `
    ------------------------------------------------------------------
    -- 1. La baja llega como bandera, nunca como ausencia
    ------------------------------------------------------------------

    alter table cliente        add column activo integer not null default 1;
    alter table presentacion   add column activo integer not null default 1;
    alter table cliente_precio add column activo integer not null default 1;

    ------------------------------------------------------------------
    -- 2. Notas pendientes por cobrar (bajan del portal)
    ------------------------------------------------------------------

    create table nota_pendiente (
      id                    text primary key,
      cliente_id            text not null references cliente(id),
      folio                 text not null,
      num_nota              text not null,
      fecha                 text not null,
      status                text not null check (status in ('pendiente', 'abonado')),
      monto_total_centavos  integer not null,
      -- Saldo que queda por liquidar. Ver la advertencia del contrato: el
      -- portal lo guarda por abono y esta pendiente de confirmar si deberia
      -- ser derivado. Aqui se refleja lo que manda, no se recalcula.
      saldo_centavos        integer not null,
      activo                integer not null default 1,
      sincronizado_en       text not null
    );

    create index idx_nota_pendiente_cliente on nota_pendiente (cliente_id, activo);

    ------------------------------------------------------------------
    -- 3. Estado de la sincronizacion
    ------------------------------------------------------------------

    -- Cursor del pull incremental. Una fila por "que se sincroniza"; hoy solo
    -- existe 'pull', pero la forma admite cursores separados sin migrar de
    -- nuevo (T-44 querra uno para el refresco de las 11:00/14:00).
    create table sync_cursor (
      entidad          text primary key,
      cursor           text not null,
      actualizado_en   text not null
    );

    -- Por que el servidor rechazo esta jornada. Sin esto, una fila en
    -- 'error' no se puede explicar ni corregir.
    alter table jornada add column sync_error text;
  `,
};
