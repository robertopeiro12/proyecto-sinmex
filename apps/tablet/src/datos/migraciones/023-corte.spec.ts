import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/**
 * La 023 (rediseño pieza 6) trae la tabla `corte`: el borrador del corte del
 * vendedor y, ya enviado, lo que capturo y lo que decia el sistema. Una fila por
 * jornada; `enviado_en` nulo = borrador.
 */

const TS = '2026-08-07T15:00:00.000Z';

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  deps.bd.runSync(
    `insert into jornada (id, fecha, vendedor_id, vehiculo_id, km_inicial, abierta_en, estado,
                          sync_estado, actualizado_local_en)
     values ('jor-1', '2026-08-07', 'ven-1', 'veh-1', 10, $ts, 'abierta', 'pendiente', $ts)`,
    { $ts: TS },
  );
  return deps.bd;
}

function insertarCorte(bd: BaseDatos, cambios: Record<string, string | number | null> = {}) {
  const fila: Record<string, string | number | null> = {
    id: 'cor-1',
    jornada_id: 'jor-1',
    fecha: '2026-08-07',
    vendedor_id: 'ven-1',
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into corte (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 023: corte del vendedor (rediseño pieza 6)', () => {
  it('es la migracion 23 y deja la base al dia', () => {
    expect(migraciones[22]?.nombre).toBe('corte');
    expect(migraciones[22]?.version).toBe(23);
    expect(versionEsquema(baseAlDia())).toBe(migraciones.length);
  });

  it('un corte nace borrador: sin enviar, pendiente y con las capturas vacias', () => {
    const bd = baseAlDia();
    insertarCorte(bd);
    expect(bd.getFirstSync('select * from corte')).toEqual({
      id: 'cor-1',
      jornada_id: 'jor-1',
      fecha: '2026-08-07',
      vendedor_id: 'ven-1',
      efectivo_json: '{}',
      notas_json: '{}',
      inventario_json: '{}',
      cerrados_json: '[]',
      enviado_en: null,
      sync_estado: 'pendiente',
      sync_error: null,
      sincronizado_en: null,
    });
  });

  it('una sola fila por jornada', () => {
    const bd = baseAlDia();
    insertarCorte(bd);
    expect(() => insertarCorte(bd, { id: 'cor-2' })).toThrow(/UNIQUE/);
  });

  it('la jornada tiene que existir', () => {
    const bd = baseAlDia();
    expect(() => insertarCorte(bd, { jornada_id: 'no-existe' })).toThrow(/FOREIGN KEY/);
  });

  it('sync_estado solo admite los cuatro estados de siempre', () => {
    const bd = baseAlDia();
    expect(() => insertarCorte(bd, { sync_estado: 'otro' })).toThrow(/CHECK/);
  });
});
