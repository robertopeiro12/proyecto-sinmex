import type { Migracion } from './motor';

/**
 * La carga y las recargas del vendedor en la tablet (T-27 pieza 1).
 *
 * - `carga` y `carga_detalle` las escribe **solo el pull** (y la respuesta del
 *   servidor al aceptar o rechazar, que trae la carga con la misma forma). La
 *   tablet no crea cargas (D1). La baja viaja como bandera (`activo = 0`).
 * - `estado` va **sin check** a proposito: si el servidor agregara uno, un check
 *   aqui haria fallar el pull entero (mismo criterio que `campo_egreso.tipo`).
 * - `carga.vendedor_id` sin llave foranea: la fila del vendedor existe desde el
 *   login, pero si faltara, la llave revertiria el pull completo. El detalle si
 *   cuelga de su carga; `presentacion_id` no, por la misma razon (una
 *   presentacion que todavia no baja no debe tumbar la carga).
 * - `actualizado_en`: cuando la tablet escribio la fila (pull o respuesta).
 * - `vendedor.control_inventario` (D7): la casilla de su sucursal, 0/1; nace en
 *   0 para que una tablet recien actualizada venda como hoy hasta el pull.
 *
 * Tablas nuevas y un `add column` con default: no rehace nada.
 */
export const cargas: Migracion = {
  version: 17,
  nombre: 'cargas',
  sql: `
    create table carga (
      id              text primary key,          -- id del servidor
      vendedor_id     text not null,
      fecha           text not null,             -- AAAA-MM-DD, hoy en Tijuana al capturarla (D8)
      numero          integer not null,
      estado          text not null,             -- pendiente | aceptada | rechazada
      motivo_rechazo  text,
      version         integer not null,
      respondida_en   text,
      activo          integer not null default 1 check (activo in (0, 1)),
      actualizado_en  text not null
    );
    -- Inventario, aviso y venta leen "las de hoy" del vendedor.
    create index idx_carga_vendedor_fecha on carga (vendedor_id, fecha);

    create table carga_detalle (
      carga_id        text not null references carga(id),
      presentacion_id text not null,
      piezas          integer not null check (piezas > 0),
      primary key (carga_id, presentacion_id)
    );

    alter table vendedor add column control_inventario integer not null default 0
      check (control_inventario in (0, 1));
  `,
};
