import { abrirBaseDatosNode } from '../driver-node';
import { migraciones } from './index';
import { ejecutarMigraciones, versionEsquema, type Migracion } from './motor';

const uno: Migracion = { version: 1, nombre: 'uno', sql: 'create table a (id text primary key);' };
const dos: Migracion = { version: 2, nombre: 'dos', sql: 'create table b (id text primary key);' };

describe('motor de migraciones locales', () => {
  describe('sinLlavesForaneas (T-40)', () => {
    /** Padre e hijo con una llave foranea y una fila en cada uno. */
    function conLlave() {
      const bd = abrirBaseDatosNode();
      ejecutarMigraciones(bd, [
        {
          version: 1,
          nombre: 'base',
          sql: `create table padre (id text primary key, dato text not null);
                create table hijo (id text primary key, padre_id text not null references padre(id));`,
        },
      ]);
      bd.runSync("insert into padre values ('p1', 'algo')");
      bd.runSync("insert into hijo values ('h1', 'p1')");
      return bd;
    }

    const rehacerPadre: Migracion = {
      version: 2,
      nombre: 'rehacer-padre',
      sinLlavesForaneas: true,
      sql: `create table padre_nueva (id text primary key, dato text);
            insert into padre_nueva (id, dato) select id, dato from padre;
            drop table padre;
            alter table padre_nueva rename to padre;`,
    };

    it('sin la bandera, rehacer una tabla referenciada falla', () => {
      // Lo que demuestra que la bandera hace falta: la MISMA migracion sin ella.
      const { sinLlavesForaneas: _omitida, ...sinBandera } = rehacerPadre;
      expect(() => ejecutarMigraciones(conLlave(), [{ version: 1, nombre: 'base', sql: 'select 1;' }, sinBandera])).toThrow(
        /FOREIGN KEY constraint failed/i,
      );
    });

    it('con la bandera, rehace la tabla sin perder al hijo ni su referencia', () => {
      const bd = conLlave();
      ejecutarMigraciones(bd, [{ version: 1, nombre: 'base', sql: 'select 1;' }, rehacerPadre]);

      expect(versionEsquema(bd)).toBe(2);
      expect(bd.getFirstSync('select * from hijo')).toEqual({ id: 'h1', padre_id: 'p1' });
      expect(
        bd.getFirstSync<{ sql: string }>(
          "select sql from sqlite_master where name = 'hijo'",
        )?.sql,
      ).toMatch(/references padre\(id\)/);
    });

    it('vuelve a encender las llaves foraneas al terminar', () => {
      const bd = conLlave();
      ejecutarMigraciones(bd, [{ version: 1, nombre: 'base', sql: 'select 1;' }, rehacerPadre]);

      expect(bd.getFirstSync('pragma foreign_keys;')).toEqual({ foreign_keys: 1 });
    });

    it('revierte (y no confirma) una migracion que deja una referencia huerfana', () => {
      const bd = conLlave();
      const olvidaCopiar: Migracion = {
        ...rehacerPadre,
        nombre: 'olvida-copiar',
        // Rehace el padre pero NO copia sus filas: el hijo queda huerfano. Sin
        // `foreign_key_check` esto pasaria el commit sin una queja.
        sql: `create table padre_nueva (id text primary key, dato text);
              drop table padre;
              alter table padre_nueva rename to padre;`,
      };

      expect(() =>
        ejecutarMigraciones(bd, [{ version: 1, nombre: 'base', sql: 'select 1;' }, olvidaCopiar]),
      ).toThrow(/huerfana/i);
      // Y no se confirmo: la version sigue en 1 y el padre original esta intacto.
      expect(versionEsquema(bd)).toBe(1);
      expect(bd.getFirstSync('select * from padre')).toEqual({ id: 'p1', dato: 'algo' });
      // Encendidas otra vez, aunque haya fallado.
      expect(bd.getFirstSync('pragma foreign_keys;')).toEqual({ foreign_keys: 1 });
    });
  });

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
