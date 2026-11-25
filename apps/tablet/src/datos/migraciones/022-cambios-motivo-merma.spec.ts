import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { ejecutarMigraciones, migraciones, versionEsquema } from './index';

/**
 * La 022 (rediseño pieza 4) trae el catalogo `motivo_merma` y rehace
 * `movimiento` para aceptar el tipo `cambio` y guardar el motivo de la merma.
 * Lo que hay que demostrar es que rehacer no se lleve nada por delante: los
 * movimientos de antes, con sus lineas, su estado y su error.
 */

const TS = '2026-11-25T00:00:00.000Z';

function baseCon021(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones.slice(0, 21));
  bd.runSync(
    `insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-1', 'TJ', 'Tijuana', $ts)`,
    { $ts: TS },
  );
  bd.runSync(
    `insert into vendedor (id, login, nombre, sucursal_id, activo, folio_segmento, sincronizado_en)
     values ('ven-1', 'ap', 'AP', 'suc-1', 1, 'AP', $ts)`,
    { $ts: TS },
  );
  bd.runSync(
    `insert into cliente (id, nombre, domicilio, telefono, tipo, promocion, sucursal_id, activo, sincronizado_en)
     values ('cli-1', 'C', 'D', '1', 'cliente', 'ninguna', 'suc-1', 1, $ts)`,
    { $ts: TS },
  );
  bd.runSync(
    `insert into movimiento (id, fecha, vendedor_id, cliente_id, tipo, comentario, registrado_en, sync_estado, sync_error)
     values
       ('mov-1', '2026-11-24', 'ven-1', 'cli-1', 'merma_cliente', 'Reventadas', $ts, 'error', 'datos-invalidos: x'),
       ('mov-2', '2026-11-24', 'ven-1', null, 'merma_trayecto', null, $ts, 'pendiente', null),
       ('mov-3', '2026-11-24', 'ven-1', null, 'consumo', null, $ts, 'sincronizado', null)`,
    { $ts: TS },
  );
  bd.execSync(`
    insert into movimiento_linea (movimiento_id, presentacion_id, sentido, piezas) values
      ('mov-1', 'pre-1', 'recibido', 3), ('mov-1', 'pre-2', 'entregado', 2),
      ('mov-2', 'pre-1', 'entregado', 1), ('mov-3', 'pre-2', 'entregado', 1);
  `);
  bd.runSync(
    `insert into sync_cursor (entidad, cursor, actualizado_en) values ('pull', 'c1', $ts), ('otra', 'c2', $ts)`,
    { $ts: TS },
  );
  return bd;
}

function migrada(): BaseDatos {
  const bd = baseCon021();
  ejecutarMigraciones(bd, migraciones);
  return bd;
}

function insertarMovimiento(bd: BaseDatos, cambios: Record<string, string | number | null> = {}) {
  const fila: Record<string, string | number | null> = {
    id: 'mov-n',
    fecha: '2026-11-25',
    vendedor_id: 'ven-1',
    cliente_id: 'cli-1',
    tipo: 'cambio',
    registrado_en: TS,
    ...cambios,
  };
  const cols = Object.keys(fila);
  bd.runSync(
    `insert into movimiento (${cols.join(', ')}) values (${cols.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(cols.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

function insertarMotivo(bd: BaseDatos) {
  bd.runSync(
    `insert into motivo_merma (id, nombre, aplica_cliente, aplica_vehiculo, activo, sincronizado_en)
     values ('mm-1', 'Caducado', 1, 0, 1, $ts)`,
    { $ts: TS },
  );
}

describe('migracion 022: cambios y motivo de merma (rediseño pieza 4)', () => {
  it('es la migracion 22 y deja la base al dia', () => {
    expect(migraciones[21]?.nombre).toBe('cambios-motivo-merma');
    expect(migraciones[21]?.version).toBe(22);
    expect(versionEsquema(migrada())).toBe(migraciones.length);
  });

  it('conserva los movimientos de antes y sus lineas, con su estado y su error, sin motivo', () => {
    const bd = migrada();
    expect(
      bd.getAllSync(
        `select id, cliente_id, tipo, comentario, sync_estado, sync_error, motivo_merma_id, motivo_nombre
           from movimiento order by id`,
      ),
    ).toEqual([
      {
        id: 'mov-1',
        cliente_id: 'cli-1',
        tipo: 'merma_cliente',
        comentario: 'Reventadas',
        sync_estado: 'error',
        sync_error: 'datos-invalidos: x',
        motivo_merma_id: null,
        motivo_nombre: null,
      },
      {
        id: 'mov-2',
        cliente_id: null,
        tipo: 'merma_trayecto',
        comentario: null,
        sync_estado: 'pendiente',
        sync_error: null,
        motivo_merma_id: null,
        motivo_nombre: null,
      },
      {
        id: 'mov-3',
        cliente_id: null,
        tipo: 'consumo',
        comentario: null,
        sync_estado: 'sincronizado',
        sync_error: null,
        motivo_merma_id: null,
        motivo_nombre: null,
      },
    ]);
    expect(bd.getFirstSync<{ n: number }>('select count(*) as n from movimiento_linea')?.n).toBe(4);
  });

  it('las llaves foraneas quedan integras y siguen vigentes despues de rehacer', () => {
    const bd = migrada();
    expect(bd.getAllSync('pragma foreign_key_check')).toEqual([]);
    // La llave de movimiento_linea sigue apuntando a la tabla rehecha.
    expect(
      bd.getAllSync<{ table: string }>('pragma foreign_key_list(movimiento_linea)').map((f) => f.table),
    ).toEqual(['movimiento']);
    expect(() =>
      bd.runSync(
        `insert into movimiento_linea (movimiento_id, presentacion_id, sentido, piezas)
         values ('no-existe', 'pre-1', 'entregado', 1)`,
      ),
    ).toThrow(/FOREIGN KEY/);
    expect(() => insertarMovimiento(bd, { cliente_id: 'no-existe' })).toThrow(/FOREIGN KEY/);
  });

  it('recrea los indices de la 018', () => {
    const indices = migrada()
      .getAllSync<{ name: string }>(`select name from pragma_index_list('movimiento') where origin = 'c'`)
      .map((i) => i.name)
      .sort();
    expect(indices).toEqual(['idx_movimiento_cliente_fecha', 'idx_movimiento_sync', 'idx_movimiento_vendedor_fecha']);
  });

  it('acepta el cambio con cliente y lo rechaza sin cliente', () => {
    const bd = migrada();
    expect(() => insertarMovimiento(bd)).not.toThrow();
    expect(() => insertarMovimiento(bd, { id: 'mov-x', cliente_id: null })).toThrow(/CHECK/);
    expect(() => insertarMovimiento(bd, { id: 'mov-y', tipo: 'consumo' })).toThrow(/CHECK/);
    expect(() => insertarMovimiento(bd, { id: 'mov-z', tipo: 'otro' })).toThrow(/CHECK/);
  });

  it('el motivo solo en las mermas, siempre con su nombre y de un motivo que existe', () => {
    const bd = migrada();
    insertarMotivo(bd);
    const conMotivo = { motivo_merma_id: 'mm-1', motivo_nombre: 'Caducado' };
    expect(() => insertarMovimiento(bd, { id: 'a', tipo: 'merma_cliente', ...conMotivo })).not.toThrow();
    expect(() =>
      insertarMovimiento(bd, { id: 'b', tipo: 'merma_trayecto', cliente_id: null, ...conMotivo }),
    ).not.toThrow();
    expect(() => insertarMovimiento(bd, { id: 'c', ...conMotivo })).toThrow(/CHECK/);
    expect(() => insertarMovimiento(bd, { id: 'd', tipo: 'consumo', cliente_id: null, ...conMotivo })).toThrow(
      /CHECK/,
    );
    expect(() =>
      insertarMovimiento(bd, { id: 'e', tipo: 'merma_cliente', motivo_merma_id: 'mm-1', motivo_nombre: null }),
    ).toThrow(/CHECK/);
    expect(() =>
      insertarMovimiento(bd, { id: 'f', tipo: 'merma_cliente', motivo_merma_id: 'no-existe', motivo_nombre: 'X' }),
    ).toThrow(/FOREIGN KEY/);
  });

  it('motivo_merma guarda las banderas 0/1', () => {
    const bd = migrada();
    insertarMotivo(bd);
    expect(bd.getFirstSync('select aplica_cliente, aplica_vehiculo, activo from motivo_merma')).toEqual({
      aplica_cliente: 1,
      aplica_vehiculo: 0,
      activo: 1,
    });
    expect(() =>
      bd.runSync(
        `insert into motivo_merma (id, nombre, aplica_cliente, sincronizado_en) values ('mm-2', 'X', 2, $ts)`,
        { $ts: TS },
      ),
    ).toThrow(/CHECK/);
  });

  it('borra el cursor del pull y deja los demas', () => {
    expect(migrada().getAllSync('select entidad from sync_cursor')).toEqual([{ entidad: 'otra' }]);
  });
});
