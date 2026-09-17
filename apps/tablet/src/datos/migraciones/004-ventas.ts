import type { Migracion } from './motor';

/**
 * La venta capturada en ruta (T-16).
 *
 * ## Cabecera y lineas
 *
 * Misma forma que `venta_nota` / `venta_nota_detalle` en Postgres (T-05) con
 * nombres locales mas cortos (`venta`, `venta_linea`); es la excepcion
 * documentada en el README a la regla de nombres iguales, y
 * `fuente-ventas.ts` hace la traduccion campo a campo. Como el resto de la
 * base local: dinero en **centavos enteros**, fechas como texto ISO.
 *
 * ## Lo que NO guarda, a proposito
 *
 * - **`status`**: lo decide el servidor al proyectar (contado -> pagada,
 *   credito -> pendiente, monto 0 -> promocion). La pantalla muestra
 *   contado/credito.
 * - **`semana` y `mes`**: los calcula el servidor de `fecha`.
 * - **Nada para editar**: una venta grabada en la tablet no se edita ni se
 *   anula; se corrige desde el portal (T-17). Por eso no hay
 *   `actualizado_local_en`.
 *
 * ## `id` es la clave de idempotencia
 *
 * Un uuid v4 generado al grabar, que no cambia nunca. Es tambien la
 * `operacion_clave` con la que se emitio su folio en `folio_emitido` (T-14):
 * esa tabla relaciona las dos cosas sin confundirlas.
 *
 * ## El folio es unico tambien aqui
 *
 * `folio_emitido` ya impide emitir dos veces el mismo folio; el `unique` de
 * `venta.folio` impide ademas que dos ventas lleven el mismo.
 */
export const ventas: Migracion = {
  version: 4,
  nombre: 'ventas',
  sql: `
    create table venta (
      id                   text primary key,          -- = clave de idempotencia
      fecha                text not null,             -- reloj.hoy(), dia de trabajo
      cliente_id           text not null references cliente(id),
      vendedor_id          text not null references vendedor(id),
      sucursal_id          text not null references sucursal(id),
      folio                text not null unique,
      num_nota             text not null check (length(trim(num_nota)) > 0),
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

    create table venta_linea (
      venta_id           text not null references venta(id),
      presentacion_id    text not null references presentacion(id),
      cantidad           integer not null check (cantidad >= 0),
      cantidad_promocion integer not null check (cantidad_promocion >= 0),
      -- El precio del catalogo local al grabar. 0 solo en lineas de pura
      -- promocion: una presentacion sin precio se puede regalar, no vender.
      precio_centavos    integer not null check (precio_centavos >= 0),
      primary key (venta_id, presentacion_id),
      check (cantidad + cantidad_promocion > 0)
    );

    -- Lo que falta por subir (mismo patron que idx_jornada_pendiente).
    create index idx_venta_sync on venta (sync_estado) where sync_estado <> 'sincronizado';
    -- "Ventas de hoy" en la ficha del cliente.
    create index idx_venta_cliente_fecha on venta (cliente_id, fecha);
  `,
};
