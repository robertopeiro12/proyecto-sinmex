import { abrirBaseDatosNode } from '../driver-node';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { ejecutarMigraciones, migraciones, versionEsquema } from './index';

/**
 * La 024 (rediseño pieza 7) agrega `nota_pendiente.detalle_json`: el detalle
 * de la nota que baja en el pull, para reimprimir una nota que no se vendio en
 * esta tablet. Texto tal cual llego; `null` si el servidor no lo manda.
 */
describe('migracion 024: detalle de la nota pendiente (rediseño pieza 7)', () => {
  it('es la migracion 24 y deja la base al dia', () => {
    const deps = depsDePrueba();
    expect(migraciones[23]?.nombre).toBe('nota-detalle');
    expect(migraciones[23]?.version).toBe(24);
    expect(versionEsquema(deps.bd)).toBe(migraciones.length);
  });

  it('la columna es texto opcional, sin default', () => {
    const deps = depsDePrueba();
    expect(
      deps.bd.getFirstSync<{ type: string; notnull: number; dflt_value: string | null }>(
        `select type, "notnull", dflt_value from pragma_table_info('nota_pendiente')
          where name = 'detalle_json'`,
      ),
    ).toEqual({ type: 'TEXT', notnull: 0, dflt_value: null });
  });

  it('borra el cursor del pull y deja los demas: el siguiente pull trae el detalle de todas', () => {
    const bd = abrirBaseDatosNode();
    ejecutarMigraciones(bd, migraciones.slice(0, 23));
    bd.runSync(
      `insert into sync_cursor (entidad, cursor, actualizado_en)
       values ('pull', 'c1', '2026-11-25T10:00:00.000Z'), ('otra', 'c2', '2026-11-25T10:00:00.000Z')`,
    );
    ejecutarMigraciones(bd, migraciones);
    expect(versionEsquema(bd)).toBe(migraciones.length);
    expect(bd.getAllSync('select entidad from sync_cursor')).toEqual([{ entidad: 'otra' }]);
  });

  it('una nota guardada sin detalle queda en null', () => {
    const deps = depsDePrueba();
    crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
    expect(
      deps.bd.getAllSync<{ id: string; detalle_json: string | null }>(
        'select id, detalle_json from nota_pendiente order by id',
      ),
    ).toEqual([
      { id: 'nota-1', detalle_json: null },
      { id: 'nota-2', detalle_json: null },
    ]);
  });
});
