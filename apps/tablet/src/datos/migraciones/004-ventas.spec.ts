import type { ValorSQL } from '../base-datos';
import { depsDePrueba, MOMENTO, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/** Base migrada al dia con el catalogo de prueba (cli-1, ven-1, suc-tj, pre-1, pre-2). */
function montar() {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

const INSERTAR_VENTA = `insert into venta
  (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, num_nota,
   contado_credito, monto_total_centavos, grabada_en)
  values ($id, $fecha, $cliente_id, $vendedor_id, $sucursal_id, $folio, $num_nota,
          $contado_credito, $monto_total_centavos, $grabada_en)`;

const INSERTAR_LINEA = `insert into venta_linea
  (venta_id, presentacion_id, cantidad, cantidad_promocion, precio_centavos)
  values ($venta_id, $presentacion_id, $cantidad, $cantidad_promocion, $precio_centavos)`;

const venta = (extra: Record<string, ValorSQL> = {}): Record<string, ValorSQL> => ({
  $id: 'venta-1',
  $fecha: '2026-08-07',
  $cliente_id: 'cli-1',
  $vendedor_id: 'ven-1',
  $sucursal_id: 'suc-tj',
  $folio: 'TJ260807AP01',
  $num_nota: '2346',
  $contado_credito: 'credito',
  $monto_total_centavos: 67200,
  $grabada_en: MOMENTO,
  ...extra,
});

const linea = (extra: Record<string, ValorSQL> = {}): Record<string, ValorSQL> => ({
  $venta_id: 'venta-1',
  $presentacion_id: 'pre-1',
  $cantidad: 24,
  $cantidad_promocion: 2,
  $precio_centavos: 2800,
  ...extra,
});

describe('migracion 004: ventas (T-16)', () => {
  it('deja la base en la version 4, con venta y venta_linea', () => {
    const bd = montar();
    expect(migraciones).toHaveLength(4);
    expect(versionEsquema(bd)).toBe(4);
    const tablas = bd.getAllSync<{ name: string }>(
      `select name from sqlite_master
        where type = 'table' and name in ('venta', 'venta_linea')
        order by name`,
    );
    expect(tablas.map((t) => t.name)).toEqual(['venta', 'venta_linea']);
  });

  it('una venta nace con factura N/A y pendiente de subir', () => {
    const bd = montar();
    bd.runSync(INSERTAR_VENTA, venta());
    expect(
      bd.getFirstSync<Record<string, unknown>>(
        'select factura, sync_estado, sync_error, comentarios from venta where id = $id',
        { $id: 'venta-1' },
      ),
    ).toEqual({ factura: 'N/A', sync_estado: 'pendiente', sync_error: null, comentarios: null });
  });

  it('dos ventas no pueden llevar el mismo folio', () => {
    const bd = montar();
    bd.runSync(INSERTAR_VENTA, venta());
    expect(() => bd.runSync(INSERTAR_VENTA, venta({ $id: 'venta-2' }))).toThrow(/UNIQUE/);
  });

  it('el numero de nota no puede ir en blanco', () => {
    const bd = montar();
    expect(() => bd.runSync(INSERTAR_VENTA, venta({ $num_nota: '   ' }))).toThrow(/CHECK/);
  });

  it('contado_credito solo acepta contado o credito', () => {
    const bd = montar();
    expect(() => bd.runSync(INSERTAR_VENTA, venta({ $contado_credito: 'fiado' }))).toThrow(
      /CHECK/,
    );
  });

  it('una linea sin cantidad ni promocion no entra', () => {
    const bd = montar();
    bd.runSync(INSERTAR_VENTA, venta());
    expect(() =>
      bd.runSync(INSERTAR_LINEA, linea({ $cantidad: 0, $cantidad_promocion: 0 })),
    ).toThrow(/CHECK/);
  });

  it('una presentacion va una sola vez por venta', () => {
    const bd = montar();
    bd.runSync(INSERTAR_VENTA, venta());
    bd.runSync(INSERTAR_LINEA, linea());
    expect(() => bd.runSync(INSERTAR_LINEA, linea({ $cantidad: 1 }))).toThrow(/UNIQUE/);
  });

  it('una linea no puede apuntar a una venta que no existe', () => {
    const bd = montar();
    expect(() => bd.runSync(INSERTAR_LINEA, linea({ $venta_id: 'no-existe' }))).toThrow(
      /FOREIGN KEY/,
    );
  });
});
