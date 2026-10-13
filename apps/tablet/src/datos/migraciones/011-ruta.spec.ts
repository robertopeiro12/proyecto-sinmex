import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 011 crea la ruta del dia (T-37, D15): `ruta` la escribe el pull,
 * `ruta_orden_local` solo el dedo del vendedor.
 */

const TS = "'2026-10-12T00:00:00.000Z'";

function baseAlDia(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${TS});
    insert into cliente (id, nombre, domicilio, telefono, tipo, promocion, sucursal_id, activo, sincronizado_en)
      values ('cli-1', 'Abarrotes La Esquina', 'Calle 5', '6641234567', 'cliente', 'ninguna', 'suc-tj', 1, ${TS});
  `);
  return bd;
}

function insertarRuta(
  bd: BaseDatos,
  id: string,
  extra: { activo?: number; origen?: string; cliente?: string } = {},
) {
  bd.runSync(
    `insert into ruta (id, cliente_id, fecha, orden, origen, activo, sincronizado_en)
     values ($id, $cliente, '2026-10-12', 1, $origen, $activo, ${TS})`,
    {
      $id: id,
      $cliente: extra.cliente ?? 'cli-1',
      $origen: extra.origen ?? 'oficina',
      $activo: extra.activo ?? 1,
    },
  );
}

describe('migracion 011: la ruta del dia (T-37)', () => {
  it('es la migracion 11 y deja la base al dia', () => {
    expect(migraciones[10]?.nombre).toBe('ruta');
    expect(migraciones[10]?.version).toBe(11);
    const bd = baseAlDia();
    expect(versionEsquema(bd)).toBe(migraciones.length);
  });

  it('una fila del servidor nace sincronizada y sin clave', () => {
    const bd = baseAlDia();
    insertarRuta(bd, 'srv-1');
    expect(
      bd.getFirstSync('select sync_estado, sync_error, clave from ruta where id = $id', {
        $id: 'srv-1',
      }),
    ).toEqual({ sync_estado: 'sincronizada', sync_error: null, clave: null });
  });

  it('el mismo cliente vivo dos veces el mismo dia no entra; una baja y una viva conviven', () => {
    const bd = baseAlDia();
    insertarRuta(bd, 'srv-1');
    expect(() => insertarRuta(bd, 'srv-2')).toThrow(/UNIQUE/);
    bd.runSync(`update ruta set activo = 0 where id = 'srv-1'`);
    expect(() => insertarRuta(bd, 'srv-2')).not.toThrow();
  });

  it('la llave foranea a cliente y el check de origen estan en pie', () => {
    const bd = baseAlDia();
    expect(() => insertarRuta(bd, 'srv-1', { cliente: 'no-existe' })).toThrow(/FOREIGN KEY/);
    expect(() => insertarRuta(bd, 'srv-2', { origen: 'portal' })).toThrow(/CHECK/);
  });

  it('ruta_orden_local guarda una posicion por (fecha, cliente)', () => {
    const bd = baseAlDia();
    const insertar = () =>
      bd.runSync(
        `insert into ruta_orden_local (fecha, cliente_id, posicion) values ('2026-10-12', 'cli-1', 1)`,
      );
    expect(insertar).not.toThrow();
    expect(insertar).toThrow(/UNIQUE|PRIMARY KEY/);
  });
});
