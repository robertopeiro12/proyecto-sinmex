import { CLAVE_PAPEL, crearPreferenciaPapel, interpretarPapel, type AlmacenPreferencia } from './preferencia';

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
