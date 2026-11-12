import type { Migracion } from './motor';

/**
 * Los movimientos de inventario en la tablet (T-27 pieza 2): la merma del
 * cliente, la merma del trayecto y el consumo propio.
 *
 * - `movimiento`: lo escribe la tablet y lo sube el push (`tipo: 'movimiento'`).
 *   `id` = clave de idempotencia y, en el servidor, el id de la fila (como el
 *   gasto). Solo la merma del cliente lleva `cliente_id` (mismo check que el
 *   servidor). No se edita ni se borra en la app (D6). `tipo` lleva check: lo
 *   escribe solo la tablet, nunca el pull.
 * - `movimiento_linea`: piezas por presentacion y sentido (`recibido` = lo danado
 *   que devuelve el cliente; `entregado` = sale de la camioneta). Sin llave
 *   foranea a `presentacion`, como `carga_detalle`.
 * - `vendedor.consumo_diario_max` (D4): el limite de su sucursal; nace en 1 (el
 *   default del servidor) hasta el pull.
 *
 * Tablas nuevas y un `add column` con default: no rehace nada.
 */
export const movimientos: Migracion = {
  version: 18,
  nombre: 'movimientos',
  sql: `
    create table movimiento (
      id              text primary key,           -- = clave de idempotencia
      fecha           text not null,              -- dia de trabajo (fecha_operacion)
      vendedor_id     text not null references vendedor(id),
      cliente_id      text references cliente(id),  -- solo la merma del cliente
      tipo            text not null check (tipo in ('merma_cliente', 'merma_trayecto', 'consumo')),
      comentario      text,
      registrado_en   text not null,              -- ISO; viaja como ocurrido_en
      sync_estado     text not null default 'pendiente'
                        check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error      text,
      sincronizado_en text,
      check ((tipo = 'merma_cliente') = (cliente_id is not null))
    );
    -- Lo que falta por subir (mismo patron que idx_gasto_sync).
    create index idx_movimiento_sync on movimiento (sync_estado) where sync_estado <> 'sincronizado';
    -- "Movimientos de hoy" del menu, el consumo del dia y el inventario.
    create index idx_movimiento_vendedor_fecha on movimiento (vendedor_id, fecha);
    -- "Movimientos de hoy" de la ficha del cliente.
    create index idx_movimiento_cliente_fecha on movimiento (cliente_id, fecha) where cliente_id is not null;

    create table movimiento_linea (
      movimiento_id   text not null references movimiento(id),
      presentacion_id text not null,
      sentido         text not null check (sentido in ('recibido', 'entregado')),
      piezas          integer not null check (piezas > 0),
      primary key (movimiento_id, presentacion_id, sentido)
    );

    alter table vendedor add column consumo_diario_max integer not null default 1
      check (consumo_diario_max >= 0);
  `,
};
