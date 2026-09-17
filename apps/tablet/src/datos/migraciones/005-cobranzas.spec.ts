import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/** Base migrada al dia con el catalogo de prueba (cli-1, ven-1, suc-tj, nota-1). */
function montar() {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

const INSERTAR_COBRANZA = `insert into cobranza
  (id, fecha, cliente_id, vendedor_id, sucursal_id, folio, venta_nota_id,
   monto_centavos, metodo_pago, fecha_pago, grabada_en)
  values ($id, '2026-08-07', 'cli-1', 'ven-1', 'suc-tj', $folio, 'nota-1',
          $monto_centavos, $metodo_pago, '2026-08-07', '2026-08-07T15:00:00.000Z')`;

const cobro = (extra: Record<string, string | number> = {}) => ({
  $id: 'cob-1',
  $folio: 'TJ260807AP01',
  $monto_centavos: 5000,
  $metodo_pago: 'efectivo',
  ...extra,
});

describe('migracion 005: cobranzas (T-20)', () => {
  it('deja la base en la version 5, con la tabla cobranza', () => {
    const bd = montar();
    expect(migraciones).toHaveLength(5);
    expect(versionEsquema(bd)).toBe(5);
    const tablas = bd.getAllSync<{ name: string }>(
      `select name from sqlite_master where type = 'table' and name = 'cobranza'`,
    );
    expect(tablas.map((t) => t.name)).toEqual(['cobranza']);
  });

  it('las columnas nuevas de notas y clientes son obligatorias y nacen vacias', () => {
    const bd = montar();
    const abonos = bd.getFirstSync<{ notnull: number; dflt_value: string }>(
      `select "notnull", dflt_value from pragma_table_info('nota_pendiente') where name = 'abonos_json'`,
    );
    const saldo = bd.getFirstSync<{ notnull: number; dflt_value: string }>(
      `select "notnull", dflt_value from pragma_table_info('cliente') where name = 'saldo_favor_centavos'`,
    );
    expect(abonos).toEqual({ notnull: 1, dflt_value: "'[]'" });
    expect(saldo).toEqual({ notnull: 1, dflt_value: '0' });
  });

  it('un cobro nace pendiente de subir y sin error', () => {
    const bd = montar();
    bd.runSync(INSERTAR_COBRANZA, cobro());
    expect(
      bd.getFirstSync<{ sync_estado: string; sync_error: string | null }>(
        `select sync_estado, sync_error from cobranza where id = 'cob-1'`,
      ),
    ).toEqual({ sync_estado: 'pendiente', sync_error: null });
  });

  it('no acepta un cobro de $0', () => {
    const bd = montar();
    expect(() => bd.runSync(INSERTAR_COBRANZA, cobro({ $monto_centavos: 0 }))).toThrow();
  });

  it('no acepta un metodo de pago fuera del catalogo', () => {
    const bd = montar();
    expect(() => bd.runSync(INSERTAR_COBRANZA, cobro({ $metodo_pago: 'tarjeta' }))).toThrow();
  });

  it('el folio es unico', () => {
    const bd = montar();
    bd.runSync(INSERTAR_COBRANZA, cobro());
    expect(() => bd.runSync(INSERTAR_COBRANZA, cobro({ $id: 'cob-2' }))).toThrow();
  });
});
