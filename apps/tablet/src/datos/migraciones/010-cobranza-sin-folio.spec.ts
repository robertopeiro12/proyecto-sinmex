import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 010 rehace `cobranza` sin la columna `folio` (T-21: la cobranza no lleva
 * folio). Lo que hay que demostrar es que rehacer no se lleve nada por delante:
 * los cobros que todavia no suben, con su estado y su error.
 */

const HASTA_009 = migraciones.slice(0, 9);

function baseCon009(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, HASTA_009);
  const ts = "'2026-10-07T00:00:00.000Z'";
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${ts});
    insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
      values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', ${ts});
    insert into cliente (id, nombre, domicilio, telefono, tipo, promocion, sucursal_id, activo, sincronizado_en)
      values ('cli-1', 'Abarrotes La Esquina', 'Calle 5', '6641234567', 'cliente', 'ninguna', 'suc-tj', 1, ${ts});
    insert into nota_pendiente
      (id, cliente_id, folio, num_nota, fecha, status, monto_total_centavos,
       saldo_centavos, activo, sincronizado_en, abonos_json)
      values ('nota-1', 'cli-1', 'TJ261001AP01', null, '2026-10-01', 'abonado',
              10000, 5000, 1, ${ts}, '[]');
    insert into cobranza
      (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, venta_nota_id,
       monto_centavos, metodo_pago, fecha_pago, grabada_en, sync_estado, sync_error)
      values
        ('cob-1', '2026-10-07', 'cli-1', 'ven-1', 'suc-tj', 'TJ261007AP02', 'nota-1',
         4000, 'transferencia', '2026-10-06', ${ts}, 'error', 'nota-no-encontrada: x'),
        ('cob-2', '2026-10-07', 'cli-1', 'ven-1', 'suc-tj', 'TJ261007AP03', 'nota-1',
         1000, 'efectivo', '2026-10-07', ${ts}, 'pendiente', null);
  `);
  return bd;
}

describe('migracion 010: la cobranza sin folio (T-21)', () => {
  it('es la migracion 10 y deja la base al dia', () => {
    expect(migraciones[9]?.nombre).toBe('cobranza-sin-folio');
    expect(migraciones[9]?.version).toBe(10);
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    expect(versionEsquema(bd)).toBe(migraciones.length);
  });

  it('quita la columna folio de cobranza', () => {
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    const columnas = bd
      .getAllSync<{ name: string }>(`select name from pragma_table_info('cobranza')`)
      .map((c) => c.name);
    expect(columnas).not.toContain('folio');
    expect(columnas).toContain('venta_nota_id');
  });

  it('conserva los cobros pendientes de subir, con su estado y su error', () => {
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    expect(
      bd.getAllSync(
        'select id, monto_centavos, metodo_pago, fecha_pago, sync_estado, sync_error from cobranza order by id',
      ),
    ).toEqual([
      {
        id: 'cob-1',
        monto_centavos: 4000,
        metodo_pago: 'transferencia',
        fecha_pago: '2026-10-06',
        sync_estado: 'error',
        sync_error: 'nota-no-encontrada: x',
      },
      {
        id: 'cob-2',
        monto_centavos: 1000,
        metodo_pago: 'efectivo',
        fecha_pago: '2026-10-07',
        sync_estado: 'pendiente',
        sync_error: null,
      },
    ]);
  });

  it('un cobro nuevo entra sin folio; las llaves foraneas y los checks siguen en pie', () => {
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    const insertar = (id: string, nota: string, metodo: string) =>
      bd.runSync(
        `insert into cobranza
           (id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id,
            monto_centavos, metodo_pago, fecha_pago, grabada_en)
         values ($id, '2026-10-07', 'cli-1', 'ven-1', 'suc-tj', $nota,
                 500, $metodo, '2026-10-07', '2026-10-07T18:00:00.000Z')`,
        { $id: id, $nota: nota, $metodo: metodo },
      );
    expect(() => insertar('cob-3', 'nota-1', 'cheque')).not.toThrow();
    expect(() => insertar('cob-4', 'no-existe', 'cheque')).toThrow(/FOREIGN KEY/);
    expect(() => insertar('cob-5', 'nota-1', 'tarjeta')).toThrow(/CHECK/);
  });

  it('recrea los indices de la 008', () => {
    const bd = baseCon009();
    ejecutarMigraciones(bd, migraciones);
    const indices = bd
      .getAllSync<{ name: string }>(
        `select name from sqlite_master where type = 'index' and tbl_name = 'cobranza'`,
      )
      .map((i) => i.name);
    expect(indices).toEqual(expect.arrayContaining(['idx_cobranza_sync', 'idx_cobranza_cliente_fecha']));
  });
});
