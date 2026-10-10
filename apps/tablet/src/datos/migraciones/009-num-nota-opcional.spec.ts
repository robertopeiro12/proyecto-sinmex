import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 009 rehace `venta` y `nota_pendiente` para que `num_nota` acepte nulos.
 * Igual que con la 005, lo que hay que demostrar es que **rehacer no se lleve
 * nada por delante**: las ventas sin subir, sus lineas, las notas por cobrar,
 * sus abonos y los cobros que les apuntan.
 */

const HASTA_008 = migraciones.slice(0, 8);

function baseCon008(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, HASTA_008);
  const ts = "'2026-10-06T00:00:00.000Z'";
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${ts});
    insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
      values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', ${ts});
    insert into producto (id, nombre, sincronizado_en) values ('pro-1', 'Jamaica', ${ts});
    insert into presentacion (id, producto_id, volumen, sincronizado_en)
      values ('pre-1', 'pro-1', '1 L', ${ts});
    insert into cliente (id, nombre, domicilio, telefono, tipo, promocion, sucursal_id, activo, sincronizado_en)
      values ('cli-1', 'Abarrotes La Esquina', 'Calle 5', '6641234567', 'cliente', 'ninguna', 'suc-tj', 1, ${ts});
    insert into venta
      (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
       contado_credito, monto_total_centavos, grabada_en, sync_estado, sync_error)
      values ('vta-1', '2026-10-06', 'cli-1', 'ven-1', 'suc-tj', 'TJ261006AP01', '9001',
              'credito', 5600, ${ts}, 'error', 'algo fallo');
    insert into venta_linea (venta_id, presentacion_id, cantidad, cantidad_promocion, precio_centavos)
      values ('vta-1', 'pre-1', 2, 1, 2800);
    insert into nota_pendiente
      (id, cliente_id, folio, num_nota, fecha, status, monto_total_centavos,
       saldo_centavos, activo, sincronizado_en, abonos_json)
      values ('nota-1', 'cli-1', 'TJ261001AP01', '1234', '2026-10-01', 'abonado',
              10000, 4000, 1, ${ts}, '[{"monto_centavos":6000}]');
    insert into cobranza
      (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, venta_nota_id,
       monto_centavos, metodo_pago, fecha_pago, grabada_en)
      values ('cob-1', '2026-10-06', 'cli-1', 'ven-1', 'suc-tj', 'TJ261006AP02', 'nota-1',
              4000, 'efectivo', '2026-10-06', ${ts});
  `);
  return bd;
}

describe('migracion 009: num_nota opcional', () => {
  it('es la migracion 9 y deja la base al dia', () => {
    expect(migraciones[8]?.nombre).toBe('num-nota-opcional');
    expect(migraciones[8]?.version).toBe(9);
    const bd = baseCon008();
    ejecutarMigraciones(bd, migraciones);
    expect(versionEsquema(bd)).toBe(migraciones.length);
  });

  it('conserva las ventas, sus lineas, las notas, sus abonos y los cobros', () => {
    const bd = baseCon008();
    ejecutarMigraciones(bd, migraciones);

    expect(bd.getAllSync('select * from venta')).toEqual([
      expect.objectContaining({
        id: 'vta-1',
        folio: 'TJ261006AP01',
        num_nota: '9001',
        sync_estado: 'error',
        sync_error: 'algo fallo',
      }),
    ]);
    expect(bd.getAllSync('select venta_id, cantidad from venta_linea')).toEqual([
      { venta_id: 'vta-1', cantidad: 2 },
    ]);
    expect(bd.getAllSync('select id, num_nota, saldo_centavos, abonos_json from nota_pendiente')).toEqual([
      {
        id: 'nota-1',
        num_nota: '1234',
        saldo_centavos: 4000,
        abonos_json: '[{"monto_centavos":6000}]',
      },
    ]);
    expect(bd.getAllSync('select id, venta_nota_id from cobranza')).toEqual([
      { id: 'cob-1', venta_nota_id: 'nota-1' },
    ]);
  });

  it('acepta una venta y una nota por cobrar sin # de nota', () => {
    const bd = baseCon008();
    ejecutarMigraciones(bd, migraciones);
    bd.runSync(
      `insert into venta
         (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
          contado_credito, monto_total_centavos, grabada_en)
       values ('vta-2', '2026-10-06', 'cli-1', 'ven-1', 'suc-tj', 'TJ261006AP03', null,
               'contado', 2800, '2026-10-06T18:00:00.000Z')`,
    );
    bd.runSync(
      `insert into nota_pendiente
         (id, cliente_id, folio, num_nota, fecha, status, monto_total_centavos,
          saldo_centavos, activo, sincronizado_en)
       values ('nota-2', 'cli-1', 'TJ261002AP01', null, '2026-10-02', 'pendiente',
               5000, 5000, 1, '2026-10-06T00:00:00.000Z')`,
    );
    expect(bd.getFirstSync(`select num_nota from venta where id = 'vta-2'`)).toEqual({
      num_nota: null,
    });
  });

  it('un # de nota en blanco sigue sin entrar: "sin nota" es null', () => {
    const bd = baseCon008();
    ejecutarMigraciones(bd, migraciones);
    expect(() =>
      bd.runSync(
        `insert into venta
           (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
            contado_credito, monto_total_centavos, grabada_en)
         values ('vta-3', '2026-10-06', 'cli-1', 'ven-1', 'suc-tj', 'TJ261006AP04', '  ',
                 'contado', 2800, '2026-10-06T18:00:00.000Z')`,
      ),
    ).toThrow(/CHECK/);
  });

  it('las llaves foraneas siguen apuntando a las tablas nuevas', () => {
    const bd = baseCon008();
    ejecutarMigraciones(bd, migraciones);
    expect(() =>
      bd.runSync(
        `insert into venta_linea (venta_id, presentacion_id, cantidad, cantidad_promocion, precio_centavos)
         values ('no-existe', 'pre-1', 1, 0, 2800)`,
      ),
    ).toThrow(/FOREIGN KEY/);
  });
});
