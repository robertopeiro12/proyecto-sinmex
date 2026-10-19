import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 014 trae la direccion del negocio en el alta de prospecto y el origen de
 * la coordenada del cliente que baja en el pull (T-72).
 */

const TS = "'2026-10-19T00:00:00.000Z'";

function baseAlDia(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${TS});
  `);
  return bd;
}

function columnas(bd: BaseDatos, tabla: string): { name: string; notnull: number }[] {
  return bd.getAllSync<{ name: string; notnull: number }>(
    `select name, "notnull" from pragma_table_info('${tabla}')`,
  );
}

describe('migracion 014: prospecto-domicilio (T-72)', () => {
  it('la 014 es la ultima y deja versionEsquema en 14', () => {
    expect(migraciones[13]?.nombre).toBe('prospecto-domicilio');
    expect(migraciones[13]?.version).toBe(14);
    expect(migraciones).toHaveLength(14);
    expect(versionEsquema(baseAlDia())).toBe(14);
  });

  it('prospecto gana domicilio, nulable (las filas anteriores no lo tienen)', () => {
    expect(columnas(baseAlDia(), 'prospecto')).toContainEqual({ name: 'domicilio', notnull: 0 });
  });

  it('cliente gana ubicacion_origen, nulable', () => {
    expect(columnas(baseAlDia(), 'cliente')).toContainEqual({ name: 'ubicacion_origen', notnull: 0 });
  });

  it('ubicacion_origen no tiene check: un valor nuevo del servidor no tumba el pull', () => {
    const bd = baseAlDia();
    expect(() =>
      bd.runSync(
        `insert into cliente (id, nombre, domicilio, telefono, tipo, sucursal_id, activo, sincronizado_en, ubicacion_origen)
         values ('cli-1', 'Abarrotes', 'Calle 5', '664', 'cliente', 'suc-tj', 1, ${TS}, 'otro-origen')`,
      ),
    ).not.toThrow();
  });
});
