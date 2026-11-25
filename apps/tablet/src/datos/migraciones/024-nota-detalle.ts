import type { Migracion } from './motor';

/**
 * Rediseño pieza 7 (impresion de notas): el detalle de la nota pendiente.
 *
 * `detalle_json` guarda **tal cual** el `detalle` que baja en el pull
 * (`NotaPendientePull.detalle`: lineas y promociones vivas, vendedor, quien
 * atendio, sucursal y hora de creacion), para reimprimir una nota que **no se
 * vendio en esta tablet**. `null` = el servidor no lo mando (uno anterior a la
 * pieza 7): la reimpresion sale sin renglones.
 *
 * **Reinicia el cursor del pull** (como la 019 y la 022): asi la siguiente
 * sincronizacion es completa y toda nota pendiente ya guardada baja con su
 * detalle, sin esperar a que cambie.
 */
export const notaDetalle: Migracion = {
  version: 24,
  nombre: 'nota-detalle',
  sql: `
    alter table nota_pendiente add column detalle_json text;

    delete from sync_cursor where entidad = 'pull';
  `,
};
