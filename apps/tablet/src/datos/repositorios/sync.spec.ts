import { depsDePrueba } from '../pruebas-apoyo';
import { crearRepositorioSync, CURSOR_PULL } from './sync';

describe('cursor del pull incremental', () => {
  it('una tablet recien instalada no tiene cursor: su primer pull es completo', () => {
    const sync = crearRepositorioSync(depsDePrueba());
    expect(sync.leerCursor()).toBeNull();
  });

  it('guarda y devuelve el cursor que mando el servidor', () => {
    const sync = crearRepositorioSync(depsDePrueba());
    sync.guardarCursor('2026-08-07T14:59:55.000Z');
    expect(sync.leerCursor()).toBe('2026-08-07T14:59:55.000Z');
  });

  it('el cursor se pisa, no se acumula', () => {
    const deps = depsDePrueba();
    const sync = crearRepositorioSync(deps);

    sync.guardarCursor('2026-08-07T10:00:00.000Z');
    sync.guardarCursor('2026-08-07T14:00:00.000Z');

    expect(sync.leerCursor()).toBe('2026-08-07T14:00:00.000Z');
    expect(deps.bd.getAllSync('select entidad from sync_cursor')).toHaveLength(1);
  });

  it('admite cursores separados por entidad (lo que necesitara T-44)', () => {
    const sync = crearRepositorioSync(depsDePrueba());
    sync.guardarCursor('2026-08-07T10:00:00.000Z');
    sync.guardarCursor('2026-08-07T14:00:00.000Z', 'refresco-media-manana');

    expect(sync.leerCursor(CURSOR_PULL)).toBe('2026-08-07T10:00:00.000Z');
    expect(sync.leerCursor('refresco-media-manana')).toBe('2026-08-07T14:00:00.000Z');
  });

  it('olvidar el cursor devuelve la tablet al vuelco completo', () => {
    // Es la salida de emergencia: caro, pero nunca incorrecto, porque el
    // snapshot se aplica con upsert.
    const sync = crearRepositorioSync(depsDePrueba());
    sync.guardarCursor('2026-08-07T14:00:00.000Z');
    sync.olvidarCursor();
    expect(sync.leerCursor()).toBeNull();
  });
});
