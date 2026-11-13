import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { ejecutarMigraciones, migraciones, versionEsquema } from './index';

/**
 * La 019 trae las notas asignadas (spec 2026-11-13): `ruta.recado`, `ruta_dia`,
 * `nota_asignada`, `nota_no_cobrada` y `cobranza.reparto_json`. Ademas borra el
 * cursor del pull para que la tablet baje todo otra vez.
 */

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

function columnas(bd: BaseDatos, tabla: string): string[] {
  return bd.getAllSync<{ name: string }>(`pragma table_info(${tabla})`).map((c) => c.name);
}

function insertarNotaNoCobrada(bd: BaseDatos, cambios: Record<string, string | number | null> = {}) {
  const fila: Record<string, string | number | null> = {
    id: 'nnc-1',
    venta_nota_id: 'nota-1',
    cliente_id: 'cli-1',
    vendedor_id: 'ven-1',
    fecha: '2026-11-13',
    comentario: 'No tenia efectivo',
    registrado_en: '2026-11-13T15:00:00.000Z',
    ...cambios,
  };
  const cols = Object.keys(fila);
  bd.runSync(
    `insert into nota_no_cobrada (${cols.join(', ')}) values (${cols.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(cols.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 019: notas asignadas', () => {
  it('la 019 es la ultima y deja versionEsquema en 19', () => {
    expect(migraciones[18]?.nombre).toBe('notas-asignadas');
    expect(migraciones[18]?.version).toBe(19);
    expect(migraciones).toHaveLength(19);
    expect(versionEsquema(baseAlDia())).toBe(19);
  });

  it('ruta lleva recado, ruta_dia y nota_asignada existen con sus columnas', () => {
    const bd = baseAlDia();
    expect(columnas(bd, 'ruta')).toContain('recado');
    expect(columnas(bd, 'ruta_dia')).toEqual(
      ['id', 'fecha', 'nombre_ruta', 'vehiculo_id', 'activo', 'sincronizado_en'],
    );
    expect(columnas(bd, 'nota_asignada')).toEqual(
      ['id', 'venta_nota_id', 'fecha', 'condicion_venta', 'activo', 'sincronizado_en'],
    );
  });

  it('nota_asignada solo acepta ninguna, liquidar o abonar', () => {
    const bd = baseAlDia();
    const alta = (id: string, condicion: string) =>
      bd.runSync(
        `insert into nota_asignada (id, venta_nota_id, fecha, condicion_venta, sincronizado_en)
         values ($id, 'nota-1', '2026-11-13', $c, '2026-11-13T10:00:00.000Z')`,
        { $id: id, $c: condicion },
      );
    expect(() => alta('a1', 'liquidar')).not.toThrow();
    expect(() => alta('a2', 'abonar')).not.toThrow();
    expect(() => alta('a3', 'ninguna')).not.toThrow();
    expect(() => alta('a4', 'otra')).toThrow(/CHECK/);
  });

  it('una cobranza vieja queda con reparto_json = [] y el cursor del pull se borra', () => {
    const bd = abrirBaseDatosNode();
    ejecutarMigraciones(bd, migraciones.slice(0, 18));
    expect(versionEsquema(bd)).toBe(18);
    expect(columnas(bd, 'cobranza')).not.toContain('reparto_json');
    bd.execSync(`
      insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-1', 'TJ', 'Tijuana', '2026-11-12T00:00:00.000Z');
      insert into vendedor (id, login, nombre, sucursal_id, activo, folio_segmento, sincronizado_en)
        values ('ven-1', 'ap', 'AP', 'suc-1', 1, 'AP', '2026-11-12T00:00:00.000Z');
      insert into cliente (id, nombre, domicilio, telefono, tipo, promocion, sucursal_id, activo, sincronizado_en)
        values ('cli-1', 'C', 'D', '1', 'cliente', 'ninguna', 'suc-1', 1, '2026-11-12T00:00:00.000Z');
      insert into nota_pendiente (id, cliente_id, folio, fecha, status, monto_total_centavos, saldo_centavos, sincronizado_en)
        values ('nota-1', 'cli-1', 'F1', '2026-11-01', 'pendiente', 5000, 5000, '2026-11-12T00:00:00.000Z');
      insert into cobranza (id, fecha, cliente_id, vendedor_id, sucursal_id, venta_nota_id, monto_centavos,
        metodo_pago, fecha_pago, grabada_en)
        values ('cob-1', '2026-11-12', 'cli-1', 'ven-1', 'suc-1', 'nota-1', 1000, 'efectivo', '2026-11-12',
        '2026-11-12T10:00:00.000Z');
      insert into sync_cursor (entidad, cursor, actualizado_en) values
        ('pull', 'c1', '2026-11-12T10:00:00.000Z'), ('otra', 'c2', '2026-11-12T10:00:00.000Z');
    `);
    ejecutarMigraciones(bd, migraciones);
    expect(versionEsquema(bd)).toBe(19);
    expect(bd.getFirstSync('select reparto_json from cobranza where id = $id', { $id: 'cob-1' })).toEqual({
      reparto_json: '[]',
    });
    expect(bd.getAllSync('select entidad from sync_cursor')).toEqual([{ entidad: 'otra' }]);
  });

  it('nota_no_cobrada nace pendiente, exige comentario y cliente/vendedor reales', () => {
    const bd = baseAlDia();
    insertarNotaNoCobrada(bd);
    expect(
      bd.getFirstSync('select sync_estado, sync_error, sincronizado_en from nota_no_cobrada where id = $id', {
        $id: 'nnc-1',
      }),
    ).toEqual({ sync_estado: 'pendiente', sync_error: null, sincronizado_en: null });
    expect(() => insertarNotaNoCobrada(bd, { id: 'n2', comentario: null })).toThrow(/NOT NULL/);
    expect(() => insertarNotaNoCobrada(bd, { id: 'n3', sync_estado: 'otro' })).toThrow(/CHECK/);
    expect(() => insertarNotaNoCobrada(bd, { id: 'n4', cliente_id: 'no-existe' })).toThrow(/FOREIGN KEY/);
    expect(() => insertarNotaNoCobrada(bd, { id: 'n5', vendedor_id: 'no-existe' })).toThrow(/FOREIGN KEY/);
  });
});
