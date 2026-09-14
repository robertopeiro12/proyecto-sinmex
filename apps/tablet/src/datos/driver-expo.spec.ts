import type { SQLiteDatabase } from 'expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import { abrirBaseDatos } from './driver-expo';

/**
 * `expo-sqlite` es un modulo nativo: no corre en Node (ver ADR-0004). No se
 * puede abrir una base real aqui, asi que se dobla `openDatabaseSync` y se
 * observa que pragmas emite `abrirBaseDatos()` al conectar. Lo que se prueba
 * no es el efecto del pragma en SQLite (eso no es observable desde Node),
 * sino que el driver real de la tablet lo pide.
 */
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(),
}));

describe('abrirBaseDatos', () => {
  it('fija journal_mode=WAL, foreign_keys=ON y synchronous=FULL al conectar', () => {
    const sentencias: string[] = [];
    const bdFalsa = {
      execSync: (sql: string) => {
        sentencias.push(sql);
      },
      runSync: jest.fn(),
      getFirstSync: jest.fn(),
      getAllSync: jest.fn(),
      closeSync: jest.fn(),
    };
    (openDatabaseSync as jest.Mock).mockReturnValue(bdFalsa as unknown as SQLiteDatabase);

    abrirBaseDatos('prueba.db');

    const emitido = sentencias.join(' | ').toLowerCase();
    expect(emitido).toMatch(/journal_mode\s*=\s*wal/);
    expect(emitido).toMatch(/foreign_keys\s*=\s*on/);
    // ADR-0010, "La jornada tiene que sobrevivir a que se acabe la pila": en
    // WAL, `synchronous = NORMAL` sobrevive a que la app se caiga pero puede
    // perderse si el equipo se apaga de golpe (pila agotada). Sin este pragma
    // fijado explicitamente, esta asercion falla.
    expect(emitido).toMatch(/synchronous\s*=\s*full/);
  });
});
