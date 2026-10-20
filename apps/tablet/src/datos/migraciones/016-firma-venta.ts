import type { Migracion } from './motor';

/**
 * La firma del cliente en la venta (T-73).
 *
 * La pantalla captura la firma en la revision, antes de grabar (D3), y
 * `ventas.registrar()` guarda la ruta del JPG y el nombre **en la misma
 * transaccion** que la venta, sus lineas y su folio: no puede quedar una venta
 * grabada sin firma por un cierre de la app a medio camino.
 *
 * La imagen sube despues, por el canal de fotos, con el **mismo esquema
 * derivado** que la foto de la visita (013) y la del gasto (015), con prefijo
 * `firma_`: `firma_local` + `firma_subida_en` + `firma_error` +
 * `firma_descartada`. Ninguna toca `sync_estado`: una firma que no sube no se
 * lleva la venta. Las ventas de antes de la 016 quedan con `firma_local` nulo y
 * nunca entran a la cola.
 *
 * `alter table … add column` alcanza (no hay que rehacer la tabla como en la
 * 009): SQLite admite agregar una columna con `not null default` y `check`.
 */
export const firmaVenta: Migracion = {
  version: 16,
  nombre: 'firma-venta',
  sql: `
    alter table venta add column firma_local text;
    alter table venta add column firma_nombre text;
    alter table venta add column firma_subida_en text;
    alter table venta add column firma_error text;
    alter table venta add column firma_descartada integer not null default 0
      check (firma_descartada in (0, 1));

    -- La cola de firmas, como idx_gasto_foto_pendiente (015).
    create index idx_venta_firma_pendiente on venta (sync_estado)
      where firma_local is not null and firma_subida_en is null and firma_descartada = 0;
  `,
};
