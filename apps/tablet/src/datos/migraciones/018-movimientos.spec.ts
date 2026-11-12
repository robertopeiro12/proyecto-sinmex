import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/**
 * La 018 trae los movimientos de inventario (T-27 pieza 2): `movimiento` y
 * `movimiento_linea`, que escribe la tablet y sube el push, y el limite de
 * consumo propio de la sucursal (`vendedor.consumo_diario_max`).
 */

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

function insertarMovimiento(bd: BaseDatos, cambios: Record<string, string | number | null> = {}) {
  const fila: Record<string, string | number | null> = {
    id: 'mov-1',
    fecha: '2026-08-07',
    vendedor_id: 'ven-1',
    cliente_id: 'cli-1',
    tipo: 'merma_cliente',
    registrado_en: '2026-08-07T15:00:00.000Z',
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into movimiento (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 018: movimientos (T-27 pieza 2)', () => {
  it('la 018 es la ultima y deja versionEsquema en 18', () => {
    expect(migraciones[17]?.nombre).toBe('movimientos');
    expect(migraciones[17]?.version).toBe(18);
    expect(migraciones).toHaveLength(18);
    expect(versionEsquema(baseAlDia())).toBe(18);
  });

  it('el vendedor que ya estaba queda con consumo diario 1 y no acepta negativos', () => {
    const bd = baseAlDia();
    expect(
      bd.getFirstSync('select consumo_diario_max from vendedor where id = $id', { $id: 'ven-1' }),
    ).toEqual({ consumo_diario_max: 1 });
    expect(() => bd.execSync("update vendedor set consumo_diario_max = -1 where id = 'ven-1'")).toThrow(/CHECK/);
  });

  it('un movimiento nace pendiente; solo la merma del cliente lleva cliente', () => {
    const bd = baseAlDia();
    insertarMovimiento(bd);
    expect(
      bd.getFirstSync('select sync_estado, sync_error, comentario from movimiento where id = $id', { $id: 'mov-1' }),
    ).toEqual({ sync_estado: 'pendiente', sync_error: null, comentario: null });
    expect(() => insertarMovimiento(bd, { id: 'mov-2', cliente_id: null })).toThrow(/CHECK/);
    expect(() => insertarMovimiento(bd, { id: 'mov-3', tipo: 'consumo' })).toThrow(/CHECK/);
    expect(() => insertarMovimiento(bd, { id: 'mov-4', tipo: 'consumo', cliente_id: null })).not.toThrow();
    expect(() => insertarMovimiento(bd, { id: 'mov-5', tipo: 'cambio', cliente_id: null })).toThrow(/CHECK/);
    expect(() => insertarMovimiento(bd, { id: 'mov-6', cliente_id: 'no-existe' })).toThrow(/FOREIGN KEY/);
  });

  it('las lineas cuelgan de su movimiento, con piezas > 0 y una vez por presentacion y sentido', () => {
    const bd = baseAlDia();
    insertarMovimiento(bd);
    const linea = (sentido: string, piezas: number, movimiento = 'mov-1', presentacion = 'pre-1') =>
      bd.runSync(
        'insert into movimiento_linea (movimiento_id, presentacion_id, sentido, piezas) values ($m, $p, $s, $n)',
        { $m: movimiento, $p: presentacion, $s: sentido, $n: piezas },
      );
    linea('recibido', 3);
    linea('entregado', 3);
    expect(() => linea('recibido', 1)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => linea('perdido', 1)).toThrow(/CHECK/);
    // Llave nueva (pre-2): asi el que truena es el check de piezas, no la llave primaria.
    expect(() => linea('entregado', 0, 'mov-1', 'pre-2')).toThrow(/CHECK/);
    expect(() => linea('recibido', 1, 'no-existe')).toThrow(/FOREIGN KEY/);
  });
});
