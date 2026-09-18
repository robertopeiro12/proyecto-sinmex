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

describe('migracion 008: cobranzas (T-20)', () => {
  it('deja la base en la version 8, con la tabla cobranza', () => {
    const bd = montar();
    // Se afirma **cual** es la migracion 8, no cuantas hay (mismo criterio que
    // `004-ventas.spec.ts`). T-20 la escribio como la 005; al integrar T-40,
    // que ya habia publicado la 005 y la 006 en `main`, paso a la 007 — y
    // **tenia** que ir despues: la 005 de T-40 rehace la tabla `cliente`, asi
    // que un `saldo_favor_centavos` agregado antes se habria perdido. Luego
    // `main` publico la 007 (la foto del prospecto, tambien de T-40), asi que
    // paso a la 008: una migracion ya publicada no se renumera.
    expect(migraciones[7]?.nombre).toBe('cobranzas');
    expect(migraciones[7]?.version).toBe(8);
    expect(versionEsquema(bd)).toBe(migraciones.length);
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
