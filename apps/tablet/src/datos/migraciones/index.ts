import { esquemaInicial } from './001-esquema-inicial';
import { sincronizacion } from './002-sincronizacion';
import { folios } from './003-folios';
import { ventas } from './004-ventas';
import { prospectoCamposOpcionales } from './005-prospecto-campos-opcionales';
import { prospectos } from './006-prospectos';
import { fotoProspecto } from './007-foto-prospecto';
import { cobranzas } from './008-cobranzas';
import { numNotaOpcional } from './009-num-nota-opcional';
import { cobranzaSinFolio } from './010-cobranza-sin-folio';
import { ruta } from './011-ruta';
import { promociones } from './012-promociones';
import { visitas } from './013-visitas';
import { prospectoDomicilio } from './014-prospecto-domicilio';
import { gastos } from './015-gastos';
import { firmaVenta } from './016-firma-venta';
import type { Migracion } from './motor';

/**
 * Catalogo de migraciones locales, **en orden y sin huecos**.
 *
 * Reglas para los tickets que vienen:
 * 1. Una migracion ya publicada **no se edita**: hay tablets en la calle con
 *    ese esquema aplicado. Se agrega una nueva.
 * 2. La version es el indice + 1 (`motor.ts` lo valida al arrancar).
 * 3. El archivo se nombra `NNN-descripcion.ts` para que ordene solo.
 */
export const migraciones: readonly Migracion[] = [
  esquemaInicial,
  sincronizacion,
  folios,
  ventas,
  prospectoCamposOpcionales,
  prospectos,
  fotoProspecto,
  cobranzas,
  numNotaOpcional,
  cobranzaSinFolio,
  ruta,
  promociones,
  visitas,
  prospectoDomicilio,
  gastos,
  firmaVenta,
];

export { ejecutarMigraciones, versionEsquema } from './motor';
export type { Migracion, ResultadoMigraciones } from './motor';
