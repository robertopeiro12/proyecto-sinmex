import {
  CLAVE_IMPRESORA,
  CLAVE_PAPEL,
  crearPreferenciaImpresora,
  crearPreferenciaPapel,
  interpretarImpresora,
  interpretarPapel,
  type AlmacenPreferencia,
} from './preferencia';

function memoria(inicial: Record<string, string> = {}): AlmacenPreferencia & { datos: Record<string, string> } {
  const datos = { ...inicial };
  return {
    datos,
    leer: async (c) => datos[c] ?? null,
    escribir: async (c, v) => {
      datos[c] = v;
    },
  };
}

describe('interpretarPapel', () => {
  test('por omisión es 58', () => {
    expect(interpretarPapel(null)).toBe(58);
    expect(interpretarPapel(undefined)).toBe(58);
    expect(interpretarPapel('')).toBe(58);
  });

  test('un valor desconocido es 58', () => {
    expect(interpretarPapel('72')).toBe(58);
    expect(interpretarPapel('80mm')).toBe(58);
    expect(interpretarPapel(' 80')).toBe(58);
  });

  test('reconoce 58 y 80', () => {
    expect(interpretarPapel('58')).toBe(58);
    expect(interpretarPapel('80')).toBe(80);
  });
});

describe('crearPreferenciaPapel', () => {
  test('sin nada guardado lee 58; guarda y relee 80', async () => {
    const almacen = memoria();
    const pref = crearPreferenciaPapel(almacen);
    expect(await pref.leerPapel()).toBe(58);
    await pref.guardarPapel(80);
    expect(almacen.datos[CLAVE_PAPEL]).toBe('80');
    expect(await pref.leerPapel()).toBe(80);
  });

  test('un almacén que falla al leer da 58', async () => {
    const pref = crearPreferenciaPapel({
      leer: async () => {
        throw new Error('keystore');
      },
      escribir: async () => undefined,
    });
    expect(await pref.leerPapel()).toBe(58);
  });
});

describe('interpretarImpresora', () => {
  test('nada guardado es null', () => {
    expect(interpretarImpresora(null)).toBeNull();
    expect(interpretarImpresora(undefined)).toBeNull();
    expect(interpretarImpresora('')).toBeNull();
  });

  test('reconoce la impresora Bluetooth y el diálogo', () => {
    expect(interpretarImpresora('{"tipo":"bluetooth","nombre":"PT-210","direccion":"66:22:32:A1:B2:C3"}')).toEqual({
      tipo: 'bluetooth',
      nombre: 'PT-210',
      direccion: '66:22:32:A1:B2:C3',
    });
    expect(interpretarImpresora('{"tipo":"dialogo"}')).toEqual({ tipo: 'dialogo' });
  });

  test('descarta campos de más', () => {
    expect(interpretarImpresora('{"tipo":"dialogo","otro":1}')).toEqual({ tipo: 'dialogo' });
  });

  test('una lectura dañada es null', () => {
    for (const v of [
      'basura',
      '{"tipo":',
      '[]',
      '"dialogo"',
      '42',
      'null',
      '{"tipo":"wifi"}',
      '{"tipo":"bluetooth","nombre":"PT-210"}',
      '{"tipo":"bluetooth","direccion":"66:22:32:A1:B2:C3"}',
      '{"tipo":"bluetooth","nombre":"","direccion":"66:22:32:A1:B2:C3"}',
      '{"tipo":"bluetooth","nombre":"PT-210","direccion":""}',
      '{"tipo":"bluetooth","nombre":7,"direccion":"66:22:32:A1:B2:C3"}',
    ]) {
      expect(interpretarImpresora(v)).toBeNull();
    }
  });
});

describe('crearPreferenciaImpresora', () => {
  test('sin nada guardado es null; guarda y relee las dos formas', async () => {
    const almacen = memoria();
    const pref = crearPreferenciaImpresora(almacen);
    expect(await pref.leerImpresora()).toBeNull();
    const bt = { tipo: 'bluetooth', nombre: 'PT-210', direccion: '66:22:32:A1:B2:C3' } as const;
    await pref.guardarImpresora(bt);
    expect(JSON.parse(almacen.datos[CLAVE_IMPRESORA] ?? '')).toEqual(bt);
    expect(await pref.leerImpresora()).toEqual(bt);
    await pref.guardarImpresora({ tipo: 'dialogo' });
    expect(await pref.leerImpresora()).toEqual({ tipo: 'dialogo' });
  });

  test('un almacén que falla al leer da null', async () => {
    const pref = crearPreferenciaImpresora({
      leer: async () => {
        throw new Error('keystore');
      },
      escribir: async () => undefined,
    });
    expect(await pref.leerImpresora()).toBeNull();
  });

  test('la clave solo usa caracteres que acepta SecureStore', () => {
    expect(CLAVE_IMPRESORA).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
