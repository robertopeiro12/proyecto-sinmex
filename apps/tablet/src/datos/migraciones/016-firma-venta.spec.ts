import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/**
 * La 016 trae la firma del cliente en la venta (T-73): el mismo esquema
 * derivado que la foto de la visita (013) y del gasto (015), con prefijo
 * `firma_`, y sin tocar `sync_estado`.
 */

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

/** Una venta como la dejaba la app antes de T-73 (sin columnas de firma). */
function insertarVentaVieja(bd: BaseDatos, cambios: Record<string, string | number | null> = {}) {
  const fila: Record<string, string | number | null> = {
    id: 'venta-vieja',
    fecha: '2026-08-07',
    cliente_id: 'cli-1',
    vendedor_id: 'ven-1',
    sucursal_id: 'suc-tj',
    folio: 'TJ260807AP01',
    contado_credito: 'contado',
    monto_total_centavos: 2800,
    grabada_en: '2026-08-07T15:00:00.000Z',
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into venta (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 016: firma de la venta (T-73)', () => {
  it('la 016 es la ultima y deja versionEsquema en 16', () => {
    expect(migraciones[15]?.nombre).toBe('firma-venta');
    expect(migraciones[15]?.version).toBe(16);
    expect(migraciones).toHaveLength(16);
    expect(versionEsquema(baseAlDia())).toBe(16);
  });

  it('una venta anterior queda sin firma, no descartada y con su sync_estado intacto', () => {
    const bd = baseAlDia();
    insertarVentaVieja(bd);
    expect(
      bd.getFirstSync(
        `select firma_local, firma_nombre, firma_subida_en, firma_error, firma_descartada, sync_estado
           from venta where id = $id`,
        { $id: 'venta-vieja' },
      ),
    ).toEqual({
      firma_local: null,
      firma_nombre: null,
      firma_subida_en: null,
      firma_error: null,
      firma_descartada: 0,
      sync_estado: 'pendiente',
    });
  });

  it('firma_descartada es 0/1', () => {
    const bd = baseAlDia();
    insertarVentaVieja(bd);
    expect(() => bd.runSync(`update venta set firma_descartada = 2 where id = 'venta-vieja'`)).toThrow(/CHECK/);
    expect(() => bd.runSync(`update venta set firma_descartada = 1 where id = 'venta-vieja'`)).not.toThrow();
  });

  it('existe el indice de la cola de firmas', () => {
    expect(
      baseAlDia().getFirstSync<{ name: string }>(
        `select name from sqlite_master where type = 'index' and name = 'idx_venta_firma_pendiente'`,
      ),
    ).toEqual({ name: 'idx_venta_firma_pendiente' });
  });
});
