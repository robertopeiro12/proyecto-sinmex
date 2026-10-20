import { nombreFirmaValido } from '@/datos/reglas-firma';

import {
  ANCHO_MAX_FIRMA_PX,
  conLimiteDeTiempo,
  crearGrabadorVenta,
  ErrorFirma,
  FIRMA_VACIA,
  firmaPorSubir,
  hayFirma,
  LARGO_MAX_NOMBRE_FIRMA,
  anchoDestinoFirma,
  nombreArchivoFirma,
  MENSAJE_FALLO_FIRMA,
  normalizarNombreFirma,
  puedeGrabarVenta,
  quitarPrefijoDataUrl,
  textoFirmada,
  trazoAPath,
  type PasosGrabarVenta,
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

describe('puedeGrabarVenta (D1)', () => {
  const UN_TRAZO = [[{ x: 1, y: 1 }]];

  it('con pago elegido, firma y sin estar grabando, si', () => {
    expect(puedeGrabarVenta({ contadoCredito: 'contado', trazos: UN_TRAZO, grabando: false })).toBe(true);
    expect(puedeGrabarVenta({ contadoCredito: 'credito', trazos: UN_TRAZO, grabando: false })).toBe(true);
  });

  it('sin firma no, ni de contado ni a credito', () => {
    expect(puedeGrabarVenta({ contadoCredito: 'contado', trazos: [], grabando: false })).toBe(false);
    expect(puedeGrabarVenta({ contadoCredito: 'credito', trazos: [[]], grabando: false })).toBe(false);
  });

  it('sin pago elegido o mientras graba, no', () => {
    expect(puedeGrabarVenta({ contadoCredito: null, trazos: UN_TRAZO, grabando: false })).toBe(false);
    expect(puedeGrabarVenta({ contadoCredito: 'contado', trazos: UN_TRAZO, grabando: true })).toBe(false);
  });

  it('volver a captura deja Grabar deshabilitado: la firma vacia no sobrevive (D4, Review Focus 2)', () => {
    expect(FIRMA_VACIA).toEqual({ trazos: [], nombre: '' });
    expect(puedeGrabarVenta({ contadoCredito: 'contado', trazos: FIRMA_VACIA.trazos, grabando: false })).toBe(false);
  });
});

describe('crearGrabadorVenta', () => {
  const pasosQue = (cambios: Partial<PasosGrabarVenta<{ id: string }>> = {}) => {
    const pasos = {
      exportarPng: jest.fn(async () => 'iVBORw0KGgo='),
      guardarJpg: jest.fn(async () => 'file:///documentos/firmas/firma-v.jpg'),
      registrar: jest.fn((_uri: string) => ({ id: 'v' })),
      ...cambios,
    };
    return pasos;
  };

  it('exporta, convierte y graba con la ruta del JPG', async () => {
    const pasos = pasosQue();
    const r = await crearGrabadorVenta<{ id: string }>().grabar(pasos);
    expect(r).toEqual({ estado: 'grabada', venta: { id: 'v' } });
    expect(pasos.guardarJpg).toHaveBeenCalledWith('iVBORw0KGgo=');
    expect(pasos.registrar).toHaveBeenCalledWith('file:///documentos/firmas/firma-v.jpg');
  });

  it('si exportar falla no graba (no se quema folio) y deja reintentar', async () => {
    const grabador = crearGrabadorVenta<{ id: string }>();
    const fallida = pasosQue({ exportarPng: jest.fn(async () => Promise.reject(new Error('sin PNG'))) });
    await expect(grabador.grabar(fallida)).resolves.toEqual({ estado: 'sin-firma', mensaje: MENSAJE_FALLO_FIRMA });
    expect(fallida.registrar).not.toHaveBeenCalled();

    const buena = pasosQue();
    await expect(grabador.grabar(buena)).resolves.toMatchObject({ estado: 'grabada' });
  });

  it('si convertir a JPG falla tampoco graba', async () => {
    const pasos = pasosQue({ guardarJpg: jest.fn(async () => Promise.reject(new Error('disco'))) });
    await expect(crearGrabadorVenta<{ id: string }>().grabar(pasos)).resolves.toEqual({
      estado: 'sin-firma',
      mensaje: MENSAJE_FALLO_FIRMA,
    });
    expect(pasos.registrar).not.toHaveBeenCalled();
  });

  it('si registrar lanza, devuelve el error y deja reintentar', async () => {
    const grabador = crearGrabadorVenta<{ id: string }>();
    const error = new Error('Sin segmento de folio');
    const fallida = pasosQue({
      registrar: jest.fn(() => {
        throw error;
      }),
    });
    await expect(grabador.grabar(fallida)).resolves.toEqual({ estado: 'error', error });
    await expect(grabador.grabar(pasosQue())).resolves.toMatchObject({ estado: 'grabada' });
  });

  it('un segundo toque mientras exporta se ignora: una sola venta, un solo folio (Review Focus 3)', async () => {
    let soltarPng: (png: string) => void = () => {};
    const pasos = pasosQue({
      exportarPng: jest.fn(
        () =>
          new Promise<string>((resolve) => {
            soltarPng = resolve;
          }),
      ),
    });
    const grabador = crearGrabadorVenta<{ id: string }>();

    const primero = grabador.grabar(pasos);
    await expect(grabador.grabar(pasos)).resolves.toBeNull();
    soltarPng('iVBORw0KGgo=');

    await expect(primero).resolves.toEqual({ estado: 'grabada', venta: { id: 'v' } });
    expect(pasos.exportarPng).toHaveBeenCalledTimes(1);
    expect(pasos.registrar).toHaveBeenCalledTimes(1);
  });

  it('despues de grabar no se suelta: un toque tardio no graba otra venta', async () => {
    const pasos = pasosQue();
    const grabador = crearGrabadorVenta<{ id: string }>();
    await grabador.grabar(pasos);
    await expect(grabador.grabar(pasos)).resolves.toBeNull();
    expect(pasos.registrar).toHaveBeenCalledTimes(1);
  });
});

describe('textos de la firma', () => {
  it('"Firmada por {nombre}" o "Firmada"', () => {
    expect(textoFirmada('Doña Lupe')).toBe('Firmada por Doña Lupe');
    expect(textoFirmada(null)).toBe('Firmada');
  });

  it('firma por subir: con firma local, sin subir y no descartada', () => {
    const base = { firma_local: 'file:///documentos/firmas/firma-v.jpg', firma_subida_en: null, firma_descartada: 0 as const };
    expect(firmaPorSubir(base)).toBe(true);
    expect(firmaPorSubir({ ...base, firma_subida_en: '2026-08-07T16:00:00.000Z' })).toBe(false);
    expect(firmaPorSubir({ ...base, firma_descartada: 1 })).toBe(false);
    expect(firmaPorSubir({ ...base, firma_local: null })).toBe(false);
  });
});
