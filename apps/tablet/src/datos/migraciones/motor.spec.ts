import { abrirBaseDatosNode } from '../driver-node';
import { migraciones } from './index';
import { ejecutarMigraciones, versionEsquema, type Migracion } from './motor';

const uno: Migracion = { version: 1, nombre: 'uno', sql: 'create table a (id text primary key);' };
const dos: Migracion = { version: 2, nombre: 'dos', sql: 'create table b (id text primary key);' };

describe('motor de migraciones locales', () => {
  it('una base nueva arranca en user_version 0', () => {
    expect(versionEsquema(abrirBaseDatosNode())).toBe(0);
  });

  it('aplica todas las migraciones pendientes y deja user_version en la ultima', () => {
    const bd = abrirBaseDatosNode();
    const resultado = ejecutarMigraciones(bd, [uno, dos]);

    expect(resultado.versionInicial).toBe(0);
    expect(resultado.versionFinal).toBe(2);
    expect(resultado.aplicadas.map((m) => m.nombre)).toEqual(['uno', 'dos']);
    expect(versionEsquema(bd)).toBe(2);
  });

  it('es idempotente: la segunda corrida no aplica nada', () => {
    const bd = abrirBaseDatosNode();
    ejecutarMigraciones(bd, [uno, dos]);

    const segunda = ejecutarMigraciones(bd, [uno, dos]);
    expect(segunda.aplicadas).toEqual([]);
    expect(segunda.versionInicial).toBe(2);
    expect(segunda.versionFinal).toBe(2);
  });

  it('aplica solo lo nuevo sobre una base que ya iba a la mitad', () => {
    const bd = abrirBaseDatosNode();
    ejecutarMigraciones(bd, [uno]);

    const segunda = ejecutarMigraciones(bd, [uno, dos]);
    expect(segunda.aplicadas.map((m) => m.version)).toEqual([2]);
    expect(versionEsquema(bd)).toBe(2);
  });

  it('revierte la migracion completa si un statement falla', () => {
    const bd = abrirBaseDatosNode();
    const rota: Migracion = {
      version: 2,
      nombre: 'rota',
      sql: 'create table b (id text primary key); esto no es sql;',
    };

    expect(() => ejecutarMigraciones(bd, [uno, rota])).toThrow(/Fallo la migracion local 2/);

    // La version se queda en la ultima que si completo...
    expect(versionEsquema(bd)).toBe(1);
    // ...y la tabla a medio crear no quedo viva.
    const tablas = bd.getAllSync<{ name: string }>(
      "select name from sqlite_master where type = 'table'",
    );
    expect(tablas.map((t) => t.name)).not.toContain('b');
  });

  it('rechaza un catalogo con versiones repetidas, desordenadas o con huecos', () => {
    const bd = abrirBaseDatosNode();
    expect(() => ejecutarMigraciones(bd, [uno, { ...dos, version: 1 }])).toThrow(/invalido/);
    expect(() => ejecutarMigraciones(bd, [dos, uno])).toThrow(/invalido/);
    expect(() => ejecutarMigraciones(bd, [uno, { ...dos, version: 3 }])).toThrow(/invalido/);
  });

  it('el catalogo real del repo es valido y deja la base migrada', () => {
    const bd = abrirBaseDatosNode();
    const resultado = ejecutarMigraciones(bd, migraciones);

    expect(resultado.versionFinal).toBe(migraciones.length);

    const tablas = bd
      .getAllSync<{ name: string }>("select name from sqlite_master where type = 'table'")
      .map((t) => t.name);
    expect(tablas).toEqual(
      expect.arrayContaining([
        'sucursal',
        'vendedor',
        'vehiculo',
        'producto',
        'presentacion',
        'cliente',
        'cliente_precio',
        'jornada',
      ]),
    );
  });
});
