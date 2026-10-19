import type { Migracion } from './motor';

/**
 * Prospecto con direccion y origen de la coordenada (T-72).
 *
 * - `prospecto.domicilio`: la "Dirección del negocio" del alta (D1). Obligatoria
 *   sin GPS, pero la regla vive en `validarAltaProspecto`, no en la tabla: las
 *   filas capturadas antes de esta version no la tienen.
 * - `cliente.ubicacion_origen`: baja en el pull (`'gps'`, `'geocodificada'`,
 *   `'manual'` o null). Se guarda y todavia no se muestra (fuera de alcance).
 *   **Sin check** a proposito: si el servidor agrega un origen, un check aqui
 *   haria fallar el upsert del snapshot entero.
 */
export const prospectoDomicilio: Migracion = {
  version: 14,
  nombre: 'prospecto-domicilio',
  sql: `
    alter table prospecto add column domicilio text;
    alter table cliente add column ubicacion_origen text;
  `,
};
