import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 012 trae las promociones por regla (T-74): la tabla que baja en el pull,
 * los regalos de cada venta local y la marca de primera venta del cliente.
 */

const TS = "'2026-10-14T00:00:00.000Z'";

function baseAlDia(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${TS});
  `);
  return bd;
}

function insertarCliente(bd: BaseDatos, id: string) {
  bd.runSync(
    `insert into cliente (id, nombre, domicilio, telefono, tipo, sucursal_id, activo, sincronizado_en)
     values ($id, 'Abarrotes La Esquina', 'Calle 5', '6641234567', 'cliente', 'suc-tj', 1, ${TS})`,
    { $id: id },
  );
}

describe('migracion 012: promociones por regla (T-74)', () => {
  it('la 012 es la ultima y deja versionEsquema en 12', () => {
    expect(migraciones[11]?.nombre).toBe('promociones');
    expect(migraciones[11]?.version).toBe(12);
    expect(migraciones).toHaveLength(12);
    expect(versionEsquema(baseAlDia())).toBe(12);
  });

  it('existe promocion con sus columnas', () => {
    const bd = baseAlDia();
    const columnas = bd
      .getAllSync<{ name: string }>(`select name from pragma_table_info('promocion')`)
      .map((c) => c.name);
    expect(columnas).toEqual(
      expect.arrayContaining([
        'audiencia',
        'compra_tipo',
        'regalo_cantidad',
        'se_repite',
        'activo',
        'sincronizado_en',
      ]),
    );
  });

  it('venta_promocion exige cantidad >= 1', () => {
    const bd = baseAlDia();
    insertarCliente(bd, 'cli-1');
    bd.execSync(`
      insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
        values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', ${TS});
      insert into venta
        (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
         contado_credito, monto_total_centavos, grabada_en)
        values ('v-1', '2026-10-14', 'cli-1', 'ven-1', 'suc-tj', 'TJ261014AP01', null,
                'contado', 0, ${TS});
    `);
    const insertar = (cantidad: number) =>
      bd.runSync(
        `insert into venta_promocion (id, venta_id, promocion_id, presentacion_id, cantidad, texto)
         values ('vp-' || $c, 'v-1', 'promo-1', 'pre-1', $c, 'Regalo')`,
        { $c: cantidad },
      );
    expect(() => insertar(0)).toThrow(/CHECK/);
    expect(() => insertar(1)).not.toThrow();
  });

  it('cliente.primera_venta_en existe y admite nulo', () => {
    const bd = baseAlDia();
    insertarCliente(bd, 'cli-1');
    expect(bd.getFirstSync('select primera_venta_en from cliente where id = $id', { $id: 'cli-1' })).toEqual({
      primera_venta_en: null,
    });
    bd.runSync(`update cliente set primera_venta_en = '2026-10-14T00:00:00.000Z' where id = 'cli-1'`);
  });

  it('la columna vieja cliente.promocion sigue existiendo con su default', () => {
    const bd = baseAlDia();
    insertarCliente(bd, 'cli-1');
    expect(bd.getFirstSync('select promocion from cliente where id = $id', { $id: 'cli-1' })).toEqual({
      promocion: 'ninguna',
    });
  });
});
