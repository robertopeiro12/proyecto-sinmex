import type { Migracion } from './motor';

/**
 * La cobranza capturada en ruta (T-20).
 *
 * ## `cobranza`
 *
 * Un pago del cliente sobre UNA nota pendiente (D1). Como la venta: dinero en
 * centavos enteros, fechas como texto ISO, `id` = clave de idempotencia y
 * `operacion_clave` de su folio en `folio_emitido`. No se edita: solo cambia
 * su estado de sincronizacion.
 *
 * No guarda el reparto: el servidor lo recalcula al proyectar con la verdad de
 * Postgres. El reparto local vive en los saldos de `nota_pendiente` y en
 * `cliente.saldo_favor_centavos`, y el siguiente pull los pisa.
 *
 * ## `nota_pendiente.abonos_json`
 *
 * Los abonos previos de la nota tal como bajan del pull (`AbonoPull[]` en JSON),
 * mas los que la tablet agrega al cobrar sin red. Se muestran al cobrar
 * ([[Cobranza-Abono]]: "mostrar fechas de abonos previos y saldo pendiente").
 * Texto y no tabla: nadie consulta dentro, solo se pinta.
 *
 * ## `cliente.saldo_favor_centavos`
 *
 * El saldo a favor que manda el pull (D5), mas el excedente de los cobros
 * locales. Solo se muestra; usarlo es del portal.
 *
 * `nota_pendiente.status` conserva su CHECK: una nota que queda en saldo 0 se
 * marca `activo = 0`, no `pagada`.
 */
export const cobranzas: Migracion = {
  version: 5,
  nombre: 'cobranzas',
  sql: `
    create table cobranza (
      id               text primary key,          -- = clave de idempotencia
      fecha            text not null,             -- dia de trabajo, el del folio
      cliente_id       text not null references cliente(id),
      vendedor_id      text not null references vendedor(id),
      sucursal_id      text not null references sucursal(id),
      folio            text not null unique,
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

    -- Lo que falta por subir (mismo patron que idx_venta_sync).
    create index idx_cobranza_sync on cobranza (sync_estado) where sync_estado <> 'sincronizado';
    -- "Cobros de hoy" del cliente.
    create index idx_cobranza_cliente_fecha on cobranza (cliente_id, fecha);

    alter table nota_pendiente add column abonos_json text not null default '[]';
    alter table cliente add column saldo_favor_centavos integer not null default 0;
  `,
};
