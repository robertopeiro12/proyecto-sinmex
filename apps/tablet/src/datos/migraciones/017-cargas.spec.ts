import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/**
 * La 017 trae la carga del vendedor (T-27 pieza 1): `carga` y `carga_detalle`,
 * que solo escribe el pull (la tablet no crea cargas), y la casilla
 * `vendedor.control_inventario`.
 */

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

function insertarCarga(bd: BaseDatos, cambios: Record<string, string | number | null> = {}) {
  const fila: Record<string, string | number | null> = {
    id: 'carga-1',
    vendedor_id: 'ven-1',
    fecha: '2026-08-07',
    numero: 1,
    estado: 'pendiente',
    version: 1,
    actualizado_en: '2026-08-07T15:00:00.000Z',
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into carga (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 017: cargas (T-27)', () => {
  it('la 017 es la ultima y deja versionEsquema en 17', () => {
    expect(migraciones[16]?.nombre).toBe('cargas');
    expect(migraciones[16]?.version).toBe(17);
    expect(migraciones).toHaveLength(17);
    expect(versionEsquema(baseAlDia())).toBe(17);
  });

  it('el vendedor que ya estaba queda con el control apagado', () => {
    const bd = baseAlDia();
    expect(
      bd.getFirstSync('select control_inventario from vendedor where id = $id', { $id: 'ven-1' }),
    ).toEqual({ control_inventario: 0 });
    expect(() => bd.execSync("update vendedor set control_inventario = 2 where id = 'ven-1'")).toThrow(
      /CHECK/,
    );
  });

  it('una carga nace viva, sin motivo ni respuesta; un estado que el servidor agregue no tumba el pull', () => {
    const bd = baseAlDia();
    insertarCarga(bd);
    expect(
      bd.getFirstSync('select activo, motivo_rechazo, respondida_en from carga where id = $id', {
        $id: 'carga-1',
      }),
    ).toEqual({ activo: 1, motivo_rechazo: null, respondida_en: null });
    expect(() => insertarCarga(bd, { id: 'carga-2', estado: 'estado-futuro' })).not.toThrow();
    expect(() => insertarCarga(bd, { id: 'carga-3', activo: 2 })).toThrow(/CHECK/);
  });

  it('el detalle cuelga de su carga, con piezas mayores que cero y una vez por presentacion', () => {
    const bd = baseAlDia();
    insertarCarga(bd);
    const linea = (piezas: number, presentacion = 'pre-1') =>
      bd.runSync(
        'insert into carga_detalle (carga_id, presentacion_id, piezas) values ($c, $p, $n)',
        { $c: 'carga-1', $p: presentacion, $n: piezas },
      );
    linea(24);
    expect(() => linea(5)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => linea(0, 'pre-2')).toThrow(/CHECK/);
    expect(() =>
      bd.runSync(
        "insert into carga_detalle (carga_id, presentacion_id, piezas) values ('no-existe', 'pre-1', 1)",
      ),
    ).toThrow(/FOREIGN KEY/);
  });
});
