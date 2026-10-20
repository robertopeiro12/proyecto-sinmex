import { abrirBaseDatosNode } from '../driver-node';
import type { BaseDatos } from '../base-datos';
import { migraciones, versionEsquema } from './index';
import { ejecutarMigraciones } from './motor';

/**
 * La 015 trae los gastos de la ruta (T-30/T-31, D8): el catalogo de campos de
 * egreso que baja en el pull y el gasto local con su foto del ticket.
 */

const TS = "'2026-10-20T00:00:00.000Z'";

function baseAlDia(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, migraciones);
  bd.execSync(`
    insert into sucursal (id, codigo, nombre, sincronizado_en) values ('suc-tj', 'TJ', 'Tijuana', ${TS});
    insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
      values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', ${TS});
    insert into campo_egreso (id, nombre, tipo, se_usa_en_app, activo, sincronizado_en)
      values ('ce-1', 'Gasolina', 'operacion', 1, 1, ${TS});
  `);
  return bd;
}

function insertarGasto(bd: BaseDatos, cambios: Record<string, string | number | null>) {
  const fila: Record<string, string | number | null> = {
    id: 'gas-1',
    fecha: '2026-10-20',
    vendedor_id: 'ven-1',
    sucursal_id: 'suc-tj',
    campo_egreso_id: 'ce-1',
    campo_nombre: 'Gasolina',
    monto_centavos: 25050,
    registrado_en: '2026-10-20T18:40:00.000Z',
    ...cambios,
  };
  const columnas = Object.keys(fila);
  bd.runSync(
    `insert into gasto (${columnas.join(', ')}) values (${columnas.map((c) => `$${c}`).join(', ')})`,
    Object.fromEntries(columnas.map((c) => [`$${c}`, fila[c] ?? null])),
  );
}

describe('migracion 015: gastos (T-30/T-31)', () => {
  it('la 015 es gastos y deja de ser la ultima con la 016 (T-73)', () => {
    expect(migraciones[14]?.nombre).toBe('gastos');
    expect(migraciones[14]?.version).toBe(15);
    expect(versionEsquema(baseAlDia())).toBe(migraciones.length);
  });

  it('un gasto entra pendiente, sin foto y no descartado', () => {
    const bd = baseAlDia();
    insertarGasto(bd, {});
    expect(
      bd.getFirstSync('select sync_estado, foto_local, foto_descartada, comentario from gasto where id = $id', {
        $id: 'gas-1',
      }),
    ).toEqual({ sync_estado: 'pendiente', foto_local: null, foto_descartada: 0, comentario: null });
  });

  it('el monto es mayor que 0', () => {
    const bd = baseAlDia();
    expect(() => insertarGasto(bd, { monto_centavos: 0 })).toThrow(/CHECK/);
    expect(() => insertarGasto(bd, { id: 'gas-2', monto_centavos: -100 })).toThrow(/CHECK/);
  });

  it('la casilla es 0/1, y un tipo que el servidor agregue no tumba el catalogo (sin check)', () => {
    const bd = baseAlDia();
    expect(() =>
      bd.execSync(
        `insert into campo_egreso (id, nombre, tipo, se_usa_en_app, activo, sincronizado_en)
           values ('ce-2', 'Otro', 'operacion', 2, 1, ${TS})`,
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      bd.execSync(
        `insert into campo_egreso (id, nombre, tipo, se_usa_en_app, activo, sincronizado_en)
           values ('ce-3', 'Nuevo', 'tipo-futuro', 0, 1, ${TS})`,
      ),
    ).not.toThrow();
  });
});
