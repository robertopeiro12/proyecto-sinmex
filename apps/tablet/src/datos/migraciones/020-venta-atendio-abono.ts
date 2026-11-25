import type { Migracion } from './motor';

/**
 * Rediseno pieza 2 (Vender y Cobranza): la venta ya no lleva firma dibujada.
 * Lleva **quien atendio** al vendedor en el negocio (obligatorio desde ahora) y,
 * en una venta a credito, el **abono** que el cliente dio al recibir.
 *
 * Sin `check`: las reglas (1..80, `0 < abono < total`, solo a credito) las
 * valida `ventas.registrar()`, igual que el servidor al recibirla. Las ventas de
 * antes de la 020 quedan con las dos columnas nulas y el push no manda las
 * claves. Las columnas `firma_*` de la 016 se quedan: las ventas viejas con
 * firma por subir siguen en su cola.
 */
export const ventaAtendioAbono: Migracion = {
  version: 20,
  nombre: 'venta-atendio-abono',
  sql: `
    alter table venta add column atendio_nombre text;
    alter table venta add column abono_centavos integer;
  `,
};
