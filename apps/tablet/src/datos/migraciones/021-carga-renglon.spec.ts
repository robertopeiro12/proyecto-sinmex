import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/**
 * La 021 (rediseno pieza 3) agrega a cada renglon de la carga si el vendedor lo
 * acepto: 1, 0 o nulo. Los renglones de antes quedan nulos: en una carga
 * `aceptada` cuentan como aceptados, en una `rechazada` como no aceptados.
 */

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

function insertarCarga(bd: BaseDatos) {
  bd.runSync(
    `insert into carga (id, vendedor_id, fecha, numero, estado, motivo_rechazo, version,
                        respondida_en, activo, actualizado_en)
     values ('carga-1', 'ven-1', '2026-08-07', 1, 'aceptada', null, 1,
             '2026-08-07T15:00:00.000Z', 1, '2026-08-07T15:00:00.000Z')`,
  );
}

describe('migracion 021: aceptada por renglon de la carga', () => {
  it('la 021 es carga-renglon y deja de ser la ultima con la 022 (rediseno pieza 4)', () => {
    expect(migraciones[20]?.nombre).toBe('carga-renglon');
    expect(migraciones[20]?.version).toBe(21);
    expect(versionEsquema(baseAlDia())).toBe(migraciones.length);
  });

  it('un renglon viejo queda con aceptada nula', () => {
    const bd = baseAlDia();
    insertarCarga(bd);
    bd.runSync(
      `insert into carga_detalle (carga_id, presentacion_id, piezas) values ('carga-1', 'pre-1', 24)`,
    );
    expect(bd.getFirstSync('select aceptada from carga_detalle')).toEqual({ aceptada: null });
  });

  it('guarda 1 y 0', () => {
    const bd = baseAlDia();
    insertarCarga(bd);
    bd.runSync(
      `insert into carga_detalle (carga_id, presentacion_id, piezas, aceptada)
       values ('carga-1', 'pre-1', 24, 1), ('carga-1', 'pre-2', 12, 0)`,
    );
    expect(
      bd.getAllSync('select presentacion_id, aceptada from carga_detalle order by presentacion_id'),
    ).toEqual([
      { presentacion_id: 'pre-1', aceptada: 1 },
      { presentacion_id: 'pre-2', aceptada: 0 },
    ]);
  });
});
