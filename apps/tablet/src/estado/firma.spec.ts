import { nombreFirmaValido } from '@/datos/reglas-firma';

import {
  ANCHO_MAX_FIRMA_PX,
  conLimiteDeTiempo,
  ErrorFirma,
  hayFirma,
  LARGO_MAX_NOMBRE_FIRMA,
  anchoDestinoFirma,
  nombreArchivoFirma,
  normalizarNombreFirma,
  quitarPrefijoDataUrl,
  trazoAPath,
} from './firma';

/**
 * La firma del cliente (T-73). Todo lo que se puede decidir sin pantalla vive en
 * `firma.ts` y se prueba aqui: la tablet no tiene pruebas de componentes.
 */

describe('trazoAPath', () => {
  it('sin puntos no dibuja nada', () => {
    expect(trazoAPath([])).toBe('');
  });

  it('varios puntos son una linea: M al primero y L a cada siguiente', () => {
    expect(
      trazoAPath([
        { x: 10, y: 20 },
        { x: 15, y: 25 },
        { x: 30, y: 22 },
      ]),
    ).toBe('M 10 20 L 15 25 L 30 22');
  });

  it('redondea a una decima: el path no carga 15 decimales por punto', () => {
    expect(
      trazoAPath([
        { x: 10.04, y: 20.06 },
        { x: 15.55, y: 25.449 },
      ]),
    ).toBe('M 10 20.1 L 15.6 25.4');
  });

  it('un toque sin arrastre es un circulo minimo (dos arcos), no un path vacio', () => {
    // Un `M x y` solo no pinta nada en Android; dos arcos de radio 1.5 con el
    // trazo de 3 px dejan un punto visible.
    expect(trazoAPath([{ x: 50, y: 60 }])).toBe('M 48.5 60 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0');
  });
});

describe('hayFirma', () => {
  it('sin trazos, o con trazos vacios, no hay firma', () => {
    expect(hayFirma([])).toBe(false);
    expect(hayFirma([[], []])).toBe(false);
  });

  it('un solo punto ya es firma', () => {
    expect(hayFirma([[], [{ x: 1, y: 1 }]])).toBe(true);
  });
});

describe('normalizarNombreFirma (D2)', () => {
  it('recorta, y en blanco es null', () => {
    expect(normalizarNombreFirma('  Doña Lupe  ')).toBe('Doña Lupe');
    expect(normalizarNombreFirma('')).toBeNull();
    expect(normalizarNombreFirma('    ')).toBeNull();
  });

  it(`hasta ${LARGO_MAX_NOMBRE_FIRMA} caracteres entra; uno mas es ErrorFirma`, () => {
    expect(normalizarNombreFirma('x'.repeat(80))).toBe('x'.repeat(80));
    expect(() => normalizarNombreFirma('x'.repeat(81))).toThrow(ErrorFirma);
    expect(() => normalizarNombreFirma('x'.repeat(81))).toThrow('no puede pasar de 80 caracteres');
  });

  it('el repositorio solo acepta null o un nombre ya recortado de 1 a 80', () => {
    expect(nombreFirmaValido(null)).toBe(true);
    expect(nombreFirmaValido('Doña Lupe')).toBe(true);
    expect(nombreFirmaValido('')).toBe(false);
    expect(nombreFirmaValido(' Doña Lupe')).toBe(false);
    expect(nombreFirmaValido('x'.repeat(81))).toBe(false);
  });
});

describe('conversion a JPG', () => {
  it(`solo se reduce lo que pasa de ${ANCHO_MAX_FIRMA_PX} px de ancho`, () => {
    expect(anchoDestinoFirma(1400)).toBe(1000);
    expect(anchoDestinoFirma(1001)).toBe(1000);
    expect(anchoDestinoFirma(1000)).toBeNull();
    expect(anchoDestinoFirma(640)).toBeNull();
  });

  it('el archivo local es firma-<idVenta>.jpg: reintentar con el mismo id lo sobrescribe', () => {
    expect(nombreArchivoFirma('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(
      'firma-3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg',
    );
  });

  it('quita el prefijo data: si toDataURL lo trae, y deja el base64 si no', () => {
    expect(quitarPrefijoDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
    expect(quitarPrefijoDataUrl('iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
  });
});

describe('conLimiteDeTiempo', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('deja pasar lo que llega a tiempo', async () => {
    await expect(conLimiteDeTiempo(Promise.resolve('png'), 1000, 'tarde')).resolves.toBe('png');
  });

  it('deja pasar el error de la promesa', async () => {
    await expect(conLimiteDeTiempo(Promise.reject(new Error('roto')), 1000, 'tarde')).rejects.toThrow('roto');
  });

  it('si no llega, rechaza con ErrorFirma al vencer el plazo', async () => {
    const nunca = new Promise<string>(() => {});
    const resultado = conLimiteDeTiempo(nunca, 1000, 'La firma tardó demasiado en guardarse.');
    jest.advanceTimersByTime(1000);
    await expect(resultado).rejects.toThrow(ErrorFirma);
  });
});
