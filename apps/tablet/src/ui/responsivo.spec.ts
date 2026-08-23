import {
  CORTE_AMPLIO,
  CORTE_MEDIO,
  escalarTipo,
  resolverDispositivo,
  type Tamano,
} from './responsivo';
import { tactil } from './tokens';

/**
 * Pruebas del unico trozo de la capa visual que se puede verificar sin
 * dispositivo. Todo lo demas (que un boton se vea bien al sol) solo se
 * comprueba en hardware — ver la bitacora del 2026-08-23 en el vault.
 */
describe('resolverDispositivo', () => {
  /** Anchos reales de equipos que puede haber en la calle. */
  const casos: [string, number, number, Tamano][] = [
    ['telefono chico vertical', 360, 800, 'compacto'],
    ['telefono grande vertical', 412, 915, 'compacto'],
    ['telefono horizontal', 800, 360, 'medio'],
    ['tablet 8" vertical', 768, 1024, 'medio'],
    ['tablet 10" horizontal', 1280, 800, 'amplio'],
    ['tablet 12" horizontal', 1366, 1024, 'amplio'],
  ];

  it.each(casos)('%s (%ix%i) es %s', (_nombre, ancho, alto, esperado) => {
    expect(resolverDispositivo(ancho, alto).tamano).toBe(esperado);
  });

  describe('los cortes son inclusivos por abajo', () => {
    it(`${CORTE_MEDIO}dp ya es medio, ${CORTE_MEDIO - 1} todavia es compacto`, () => {
      expect(resolverDispositivo(CORTE_MEDIO, 1000).tamano).toBe('medio');
      expect(resolverDispositivo(CORTE_MEDIO - 1, 1000).tamano).toBe('compacto');
    });

    it(`${CORTE_AMPLIO}dp ya es amplio, ${CORTE_AMPLIO - 1} todavia es medio`, () => {
      expect(resolverDispositivo(CORTE_AMPLIO, 1000).tamano).toBe('amplio');
      expect(resolverDispositivo(CORTE_AMPLIO - 1, 1000).tamano).toBe('medio');
    });
  });

  it('detecta la orientacion por la forma de la ventana, no por el tamano', () => {
    expect(resolverDispositivo(800, 1280).vertical).toBe(true);
    expect(resolverDispositivo(1280, 800).vertical).toBe(false);
  });

  /**
   * Esta es la regla que mas facil se rompe al "optimizar" espacio en un
   * telefono. Si alguien la invierte, el vendedor pierde toques con el pulgar
   * en movimiento, que es justo cuando mas cuesta acertar.
   */
  it('el objetivo tactil es MAS grande en telefono que en tablet', () => {
    const telefono = resolverDispositivo(360, 800);
    const tableta = resolverDispositivo(1280, 800);

    expect(telefono.tactil).toBeGreaterThan(tableta.tactil);
    expect(telefono.tactil).toBe(tactil.compacto);
  });

  it('nunca baja del minimo accesible de 48dp en ningun tamano', () => {
    for (const [, ancho, alto] of casos) {
      expect(resolverDispositivo(ancho, alto).tactil).toBeGreaterThanOrEqual(48);
    }
  });

  it('el telefono va a una columna y la tablet horizontal a tres', () => {
    expect(resolverDispositivo(360, 800).columnas).toBe(1);
    expect(resolverDispositivo(768, 1024).columnas).toBe(2);
    expect(resolverDispositivo(1280, 800).columnas).toBe(3);
  });

  it('el telefono usa todo el ancho; la tablet acota la columna de lectura', () => {
    expect(resolverDispositivo(360, 800).anchoLectura).toBeNull();

    const tableta = resolverDispositivo(1280, 800);
    expect(tableta.anchoLectura).not.toBeNull();
    expect(tableta.anchoLectura!).toBeLessThan(tableta.ancho);
  });

  it('las columnas y el margen no decrecen al crecer la pantalla', () => {
    const anchos = [320, 480, 599, 600, 768, 899, 900, 1280, 1600];
    const columnas = anchos.map((a) => resolverDispositivo(a, 800).columnas);
    const margenes = anchos.map((a) => resolverDispositivo(a, 800).margen);

    expect(columnas).toEqual([...columnas].sort((a, b) => a - b));
    expect(margenes).toEqual([...margenes].sort((a, b) => a - b));
  });

  it('aguanta anchos absurdos sin romperse', () => {
    expect(resolverDispositivo(0, 0).tamano).toBe('compacto');
    expect(resolverDispositivo(9999, 9999).tamano).toBe('amplio');
  });
});

describe('escalarTipo', () => {
  it('devuelve enteros: los medios puntos parten lineas distinto en cada equipo', () => {
    for (const escala of [1, 1.05, 1.1]) {
      for (const base of [13, 16, 19, 22, 30, 34]) {
        expect(Number.isInteger(escalarTipo(base, escala))).toBe(true);
      }
    }
  });

  it('mantiene la jerarquia en los tres tamanos', () => {
    for (const escala of [1, 1.05, 1.1]) {
      expect(escalarTipo(13, escala)).toBeLessThan(escalarTipo(16, escala));
      expect(escalarTipo(16, escala)).toBeLessThan(escalarTipo(22, escala));
      expect(escalarTipo(22, escala)).toBeLessThan(escalarTipo(30, escala));
    }
  });

  it('la tablet nunca achica el texto respecto al telefono', () => {
    for (const base of [13, 16, 19, 22, 30, 34]) {
      expect(escalarTipo(base, 1.1)).toBeGreaterThanOrEqual(escalarTipo(base, 1));
    }
  });
});
