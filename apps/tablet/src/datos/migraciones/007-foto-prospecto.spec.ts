import { abrirBaseDatosNode } from '../driver-node';
import { esquemaInicial } from './001-esquema-inicial';
import { sincronizacion } from './002-sincronizacion';
import { folios } from './003-folios';
import { ventas } from './004-ventas';
import { prospectoCamposOpcionales } from './005-prospecto-campos-opcionales';
import { prospectos } from './006-prospectos';
import { fotoProspecto } from './007-foto-prospecto';
import { ejecutarMigraciones } from './motor';
import type { BaseDatos } from '../base-datos';

/**
 * La 007 agrega las tres columnas del estado de subida de la foto.
 *
 * Son `alter table add column`, no una tabla rehecha, asi que lo que hay que
 * demostrar no es la integridad referencial (eso era la 005) sino tres cosas:
 * que las columnas entran **sobre una base que ya tiene prospectos capturados**
 * (hay tablets en la calle con la 006 aplicada y filas dentro), que
 * `foto_descartada` nace en 0 sin dejar nulos, y que el `check` de verdad muerde.
 */

const HASTA_006 = [
  esquemaInicial,
  sincronizacion,
  folios,
  ventas,
  prospectoCamposOpcionales,
  prospectos,
] as const;
const TODAS = [...HASTA_006, fotoProspecto] as const;

const MOMENTO = '2026-09-18T15:00:00.000Z';

/** Base migrada hasta 006, con un prospecto ya capturado y con foto. */
function baseCon006(): BaseDatos {
  const bd = abrirBaseDatosNode();
  ejecutarMigraciones(bd, HASTA_006);

  bd.runSync(
    `insert into sucursal (id, codigo, nombre, sincronizado_en)
     values ('suc-tj', 'TJ', 'Tijuana', $en)`,
    { $en: MOMENTO },
  );
  bd.runSync(
    `insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
     values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', $en)`,
    { $en: MOMENTO },
  );
  // Ya sincronizado y con foto: es exactamente la fila que la 007 tiene que
  // encontrar intacta y volver elegible para el paso de fotos.
  bd.runSync(
    `insert into prospecto
       (id, fecha, vendedor_id, sucursal_id, nombre, telefono, foto_uri,
        grabado_en, sync_estado, sincronizado_en)
     values ('pro-1', '2026-09-18', 'ven-1', 'suc-tj', 'Tacos Aaron', '6641112233',
             'file:///cache/pro-1.jpg', $en, 'sincronizado', $en)`,
    { $en: MOMENTO },
  );
  return bd;
}

describe('migracion 007 (estado de subida de la foto)', () => {
  it('sin la migracion, las columnas de la foto no existen', () => {
    // La prueba que falla si alguien quita la migracion: el repositorio consulta
    // `foto_subida_en` en cada pasada de sincronizacion, y sin la columna no
    // fallaria la foto — fallaria el paso entero con un error de SQL.
    const bd = baseCon006();
    expect(() =>
      bd.getAllSync('select foto_subida_en from prospecto'),
    ).toThrow(/foto_subida_en/i);
  });

  it('las tres columnas entran sobre una base que ya tiene prospectos', () => {
    const bd = baseCon006();
    // Se pasa el catalogo COMPLETO y no `[fotoProspecto]`: `validarCatalogo`
    // exige `version === indice + 1`, asi que una migracion suelta en un array de
    // uno es invalida por definicion. El motor aplica solo la pendiente.
    ejecutarMigraciones(bd, TODAS);

    expect(
      bd.getFirstSync<Record<string, unknown>>(
        `select foto_uri, foto_subida_en, foto_error, foto_descartada
           from prospecto where id = 'pro-1'`,
      ),
    ).toEqual({
      // La ruta que ya estaba sigue ahi: la foto de una tablet que capturo con
      // la 006 no se pierde al actualizar la app.
      foto_uri: 'file:///cache/pro-1.jpg',
      foto_subida_en: null,
      foto_error: null,
      // Nace en 0 y no en null: `not null default 0`. Un null aqui haria que
      // `foto_descartada = 0` del `where` de la cola excluyera la fila, y esa
      // foto no se intentaria nunca sin que nada lo dijera.
      foto_descartada: 0,
    });
  });

  it('el prospecto que ya estaba queda elegible para subir su foto', () => {
    // El caso real de la actualizacion: la fila cumple las cuatro condiciones de
    // la cola en cuanto la migracion corre, sin que nadie la toque.
    const bd = baseCon006();
    // Se pasa el catalogo COMPLETO y no `[fotoProspecto]`: `validarCatalogo`
    // exige `version === indice + 1`, asi que una migracion suelta en un array de
    // uno es invalida por definicion. El motor aplica solo la pendiente.
    ejecutarMigraciones(bd, TODAS);

    expect(
      bd.getAllSync<{ id: string }>(
        `select id from prospecto
          where sync_estado = 'sincronizado'
            and foto_uri is not null
            and foto_subida_en is null
            and foto_descartada = 0`,
      ),
    ).toEqual([{ id: 'pro-1' }]);
  });

  it('`foto_descartada` solo acepta 0 y 1', () => {
    // El `check` es lo que impide que un valor raro (un 2 de un bug, un null de
    // un `update` a medias) haga que la foto ni se intente ni se descarte: se
    // quedaria invisible en los dos sentidos.
    const bd = abrirBaseDatosNode();
    ejecutarMigraciones(bd, TODAS);
    bd.runSync(
      `insert into sucursal (id, codigo, nombre, sincronizado_en)
       values ('suc-tj', 'TJ', 'Tijuana', $en)`,
      { $en: MOMENTO },
    );
    bd.runSync(
      `insert into vendedor (id, login, nombre, sucursal_id, sincronizado_en)
       values ('ven-1', 'aperez', 'Abraham Perez', 'suc-tj', $en)`,
      { $en: MOMENTO },
    );
    bd.runSync(
      `insert into prospecto (id, fecha, vendedor_id, sucursal_id, nombre, telefono, grabado_en)
       values ('pro-9', '2026-09-18', 'ven-1', 'suc-tj', 'Abarrotes', '6640000000', $en)`,
      { $en: MOMENTO },
    );

    expect(() =>
      bd.runSync("update prospecto set foto_descartada = 2 where id = 'pro-9'"),
    ).toThrow(/CHECK/i);
    expect(() =>
      bd.runSync("update prospecto set foto_descartada = null where id = 'pro-9'"),
    ).toThrow(/NOT NULL/i);
  });

  it('crea el indice parcial de la cola de fotos', () => {
    const bd = abrirBaseDatosNode();
    ejecutarMigraciones(bd, TODAS);

    const indice = bd.getFirstSync<{ sql: string }>(
      `select sql from sqlite_master
        where type = 'index' and name = 'idx_prospecto_foto_pendiente'`,
    );
    expect(indice).not.toBeNull();
    // Parcial de verdad: si el `where` se cayera, el indice cubriria las miles de
    // filas que no tienen foto en vez de las pocas que faltan por subir.
    expect(indice?.sql).toMatch(/where/i);
  });

  it('deja la base en la version 7', () => {
    const bd = abrirBaseDatosNode();
    const r = ejecutarMigraciones(bd, TODAS);
    expect(r.versionFinal).toBe(7);
  });
});
