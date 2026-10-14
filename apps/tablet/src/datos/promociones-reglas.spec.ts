import {
  aplicarRegalos,
  calcularRegalos,
  cobertura,
  coincidenEnProducto,
  problemasDeRegalos,
  promocionesAplicables,
  textoPromocion,
  type CatalogoPromociones,
  type PromocionAplicable,
  type Regalo,
} from './promociones-reglas';
import { MOMENTO, snapshotDePrueba } from './pruebas-apoyo';
import type { Cliente, Promocion } from './tipos';
import type { LineaCaptura } from './ventas-reglas';

// El orden del Map es el orden del catalogo: decide el empate de D16.
const catalogo: CatalogoPromociones = {
  presentaciones: new Map([
    ['pre-1', { productoId: 'pro-1', etiqueta: 'Jamaica 1 L' }],
    ['pre-2', { productoId: 'pro-1', etiqueta: 'Jamaica 500 ml' }],
    ['pre-3', { productoId: 'pro-2', etiqueta: 'Horchata 1 L' }],
  ]),
  productos: new Map([
    ['pro-1', 'Jamaica'],
    ['pro-2', 'Horchata'],
  ]),
};

const semillas = snapshotDePrueba().promociones ?? [];
const semilla = (id: string): Promocion => {
  const p = semillas.find((s) => s.id === id);
  if (!p) throw new Error(`falta la semilla ${id}`);
  return { ...p, sincronizado_en: MOMENTO };
};

/** Parte de la general: por cada 10 Jamaica, 1 Jamaica, se repite. */
const promo = (extra: Partial<Promocion> = {}): Promocion => ({ ...semilla('promo-general'), ...extra });
const prospecto = (extra: Partial<Promocion> = {}): Promocion => ({ ...semilla('promo-prospecto'), ...extra });
const aplicable = (p: Promocion): PromocionAplicable => ({ ...p, texto: textoPromocion(p, catalogo) });

const linea = (presentacionId: string, cantidad: number): LineaCaptura => ({
  presentacionId,
  etiqueta: catalogo.presentaciones.get(presentacionId)?.etiqueta ?? '',
  cantidad,
  cantidadPromocion: 0,
  precioCentavos: 1000,
});

const sinElecciones: ReadonlyMap<string, string> = new Map();

const cliente = (extra: Partial<Pick<Cliente, 'id' | 'tipo' | 'primera_venta_en'>> = {}) => ({
  id: 'cli-1',
  tipo: 'cliente' as Cliente['tipo'],
  primera_venta_en: null as string | null,
  ...extra,
});

describe('textoPromocion (T-74), las mismas frases que el backend', () => {
  it('por cada N de un producto, M del mismo, se repite', () => {
    expect(textoPromocion(promo(), catalogo)).toBe('Por cada 10 Jamaica, 1 Jamaica gratis');
  });

  it('al comprar N de una presentacion, M de la misma, una vez', () => {
    const p = promo({
      audiencia: 'cliente',
      cliente_id: 'cli-1',
      compra_tipo: 'presentacion',
      compra_producto_id: null,
      compra_presentacion_id: 'pre-2',
      se_repite: 0,
    });
    expect(textoPromocion(p, catalogo)).toBe('Al comprar 10 Jamaica 500 ml, 1 Jamaica 500 ml gratis (una vez)');
  });

  it('por cada N piezas de lo que sea, M de una presentacion', () => {
    const p = promo({
      compra_tipo: 'cualquiera',
      compra_producto_id: null,
      compra_cantidad: 20,
      regalo_tipo: 'presentacion',
      regalo_presentacion_id: 'pre-1',
    });
    expect(textoPromocion(p, catalogo)).toBe('Por cada 20 piezas de lo que sea, 1 Jamaica 1 L gratis');
  });

  it('por cada pieza (singular), M de un producto', () => {
    const p = promo({
      compra_tipo: 'cualquiera',
      compra_producto_id: null,
      compra_cantidad: 1,
      regalo_tipo: 'producto',
      regalo_producto_id: 'pro-2',
    });
    expect(textoPromocion(p, catalogo)).toBe('Por cada pieza, 1 Horchata gratis');
  });

  it('bienvenida al prospecto sin compra', () => {
    expect(textoPromocion(prospecto(), catalogo)).toBe(
      'Bienvenida al prospecto: 2 Jamaica 500 ml gratis en su primera venta',
    );
  });

  it('bienvenida al prospecto con compra', () => {
    const p = promo({ audiencia: 'prospecto', compra_cantidad: 5, se_repite: 0 });
    expect(textoPromocion(p, catalogo)).toBe(
      'Bienvenida al prospecto: al comprar 5 Jamaica, 1 Jamaica gratis en su primera venta',
    );
  });

  it('sin nombre en el catalogo no revienta: deja un hueco visible', () => {
    expect(textoPromocion(promo({ compra_producto_id: 'pro-9' }), catalogo)).toBe(
      'Por cada 10 (producto), 1 (producto) gratis',
    );
  });
});

describe('cobertura / coincidenEnProducto (D5)', () => {
  it('cualquiera cubre todos los productos', () => {
    expect(cobertura(promo({ compra_tipo: 'cualquiera', compra_producto_id: null }), catalogo)).toBe('todos');
  });

  it('por producto cubre ese producto', () => {
    expect(cobertura(promo(), catalogo)).toEqual(new Set(['pro-1']));
  });

  it('por presentacion cubre el producto de la presentacion', () => {
    const p = promo({ compra_tipo: 'presentacion', compra_producto_id: null, compra_presentacion_id: 'pre-2' });
    expect(cobertura(p, catalogo)).toEqual(new Set(['pro-1']));
  });

  it('coinciden si comparten producto o si alguna es todos', () => {
    expect(coincidenEnProducto(new Set(['pro-1']), new Set(['pro-1']))).toBe(true);
    expect(coincidenEnProducto(new Set(['pro-1']), new Set(['pro-2']))).toBe(false);
    expect(coincidenEnProducto('todos', new Set(['pro-2']))).toBe(true);
    expect(coincidenEnProducto(new Set(['pro-1']), 'todos')).toBe(true);
    expect(coincidenEnProducto(new Set(), new Set(['pro-1']))).toBe(false);
  });
});

describe('promocionesAplicables (D5, D7)', () => {
  const propia = (extra: Partial<Promocion> = {}) =>
    promo({ id: 'promo-propia', audiencia: 'cliente', cliente_id: 'cli-1', compra_cantidad: 5, ...extra });
  const general2 = promo({ id: 'promo-general-2', compra_producto_id: 'pro-2' });
  const ids = (ps: PromocionAplicable[]) => ps.map((p) => p.id);
  const aplicables = (
    promociones: Promocion[],
    c = cliente(),
    tieneVentas = false,
  ) => promocionesAplicables({ cliente: c, tieneVentas, promociones, catalogo });

  it('un cliente ve las generales y las suyas, no la de prospecto', () => {
    const otraPropia = propia({ compra_producto_id: 'pro-2', id: 'promo-propia-2' });
    expect(ids(aplicables([promo(), prospecto(), otraPropia]))).toEqual(['promo-propia-2', 'promo-general']);
  });

  it('una propia que coincide en producto desplaza a la general', () => {
    expect(ids(aplicables([promo(), propia()]))).toEqual(['promo-propia']);
  });

  it('una propia de otro producto no desplaza la general', () => {
    expect(ids(aplicables([promo(), propia({ compra_producto_id: 'pro-2' })]))).toEqual([
      'promo-propia',
      'promo-general',
    ]);
  });

  it('una propia por presentacion desplaza la general de su producto', () => {
    const p = propia({ compra_tipo: 'presentacion', compra_producto_id: null, compra_presentacion_id: 'pre-2' });
    expect(ids(aplicables([promo(), general2, p]))).toEqual(['promo-propia', 'promo-general-2']);
  });

  it('una propia "cualquiera" desplaza todas las generales', () => {
    const p = propia({ compra_tipo: 'cualquiera', compra_producto_id: null });
    expect(ids(aplicables([promo(), general2, p]))).toEqual(['promo-propia']);
  });

  it('una propia inactiva no desplaza ni aparece', () => {
    expect(ids(aplicables([promo(), propia({ activo: 0 })]))).toEqual(['promo-general']);
  });

  it('una general inactiva no aparece', () => {
    expect(ids(aplicables([promo({ activo: 0 })]))).toEqual([]);
  });

  it('la propia de otro cliente no aparece ni desplaza', () => {
    expect(ids(aplicables([promo(), propia({ cliente_id: 'cli-2' })]))).toEqual(['promo-general']);
  });

  it('un prospecto sin primera venta ve la de bienvenida', () => {
    const c = cliente({ tipo: 'prospecto' });
    expect(ids(aplicables([promo(), prospecto()], c))).toEqual(['promo-general', 'promo-prospecto']);
  });

  it('un prospecto con primera venta en el servidor no la ve', () => {
    const c = cliente({ tipo: 'prospecto', primera_venta_en: '2026-08-01T15:00:00.000Z' });
    expect(ids(aplicables([prospecto()], c))).toEqual([]);
  });

  it('un prospecto con ventas en esta tablet no la ve', () => {
    expect(ids(aplicables([prospecto()], cliente({ tipo: 'prospecto' }), true))).toEqual([]);
  });

  it('un cliente sin primera venta tampoco la ve', () => {
    expect(ids(aplicables([prospecto()], cliente({ tipo: 'cliente' })))).toEqual([]);
  });

  it('una de bienvenida inactiva no aparece', () => {
    expect(ids(aplicables([prospecto({ activo: 0 })], cliente({ tipo: 'prospecto' })))).toEqual([]);
  });

  it('orden: propias, generales, prospecto; cada una con su texto', () => {
    const c = cliente({ tipo: 'prospecto' });
    const p = propia({ compra_producto_id: 'pro-2' });
    const resultado = aplicables([prospecto(), promo(), p], c);
    expect(ids(resultado)).toEqual(['promo-propia', 'promo-general', 'promo-prospecto']);
    expect(resultado.map((r) => r.texto)).toEqual([
      'Por cada 5 Horchata, 1 Horchata gratis',
      'Por cada 10 Jamaica, 1 Jamaica gratis',
      'Bienvenida al prospecto: 2 Jamaica 500 ml gratis en su primera venta',
    ]);
  });
});

describe('calcularRegalos (D2, D16, D18)', () => {
  const calcular = (lineas: LineaCaptura[], promociones: Promocion[], elecciones = sinElecciones) =>
    calcularRegalos(lineas, promociones.map(aplicable), catalogo, elecciones);

  it('por cada 10, se repite: 25 piezas dan 2 regalos en la presentacion comprada', () => {
    expect(calcular([linea('pre-1', 25)], [promo()])).toEqual([
      {
        promocionId: 'promo-general',
        texto: 'Por cada 10 Jamaica, 1 Jamaica gratis',
        productoId: 'pro-1',
        presentacionId: 'pre-1',
        cantidad: 2,
      },
    ]);
  });

  it('con 9 piezas no hay regalo', () => {
    expect(calcular([linea('pre-1', 9)], [promo()])).toEqual([]);
  });

  it('sin repetir: 25 piezas dan un solo bloque', () => {
    const [r] = calcular([linea('pre-1', 25)], [promo({ se_repite: 0 })]);
    expect(r?.cantidad).toBe(1);
  });

  it('la de prospecto nunca se repite: compra 10, se_repite 1 y 30 piezas dan un solo bloque', () => {
    const p = promo({ audiencia: 'prospecto', compra_cantidad: 10, se_repite: 1 });
    const [r] = calcular([linea('pre-1', 30)], [p]);
    expect(r?.cantidad).toBe(1);
  });

  it('suma las presentaciones del producto y regala en la que mas compro', () => {
    expect(calcular([linea('pre-1', 6), linea('pre-2', 4)], [promo()])).toMatchObject([
      { presentacionId: 'pre-1', cantidad: 1 },
    ]);
    expect(calcular([linea('pre-1', 4), linea('pre-2', 6)], [promo()])).toMatchObject([
      { presentacionId: 'pre-2', cantidad: 1 },
    ]);
  });

  it('empate: la primera presentacion en el orden del catalogo', () => {
    expect(calcular([linea('pre-2', 5), linea('pre-1', 5)], [promo()])).toMatchObject([
      { presentacionId: 'pre-1', cantidad: 1 },
    ]);
  });

  it('compra por presentacion: regala en ella y no cuenta las otras del producto', () => {
    const p = promo({ compra_tipo: 'presentacion', compra_producto_id: null, compra_presentacion_id: 'pre-2' });
    expect(calcular([linea('pre-1', 10), linea('pre-2', 10)], [p])).toMatchObject([
      { productoId: 'pro-1', presentacionId: 'pre-2', cantidad: 1 },
    ]);
  });

  it('compra cualquiera con regalo de una presentacion; lo regalado antes no cuenta (D18)', () => {
    const p = promo({
      compra_tipo: 'cualquiera',
      compra_producto_id: null,
      compra_cantidad: 20,
      regalo_tipo: 'presentacion',
      regalo_presentacion_id: 'pre-3',
    });
    const lineas = [
      { ...linea('pre-1', 12), cantidadPromocion: 5 },
      { ...linea('pre-3', 8), cantidadPromocion: 5 },
    ];
    expect(calcular(lineas, [p])).toMatchObject([{ productoId: 'pro-2', presentacionId: 'pre-3', cantidad: 1 }]);
    // Con 19 compradas no alcanza, aunque con lo regalado pasaria de 20.
    expect(calcular([{ ...linea('pre-1', 11), cantidadPromocion: 9 }, linea('pre-3', 8)], [p])).toEqual([]);
  });

  describe('regalo de un producto completo', () => {
    const completo = (productoId: string) =>
      promo({
        id: 'promo-completo',
        compra_tipo: 'cualquiera',
        compra_producto_id: null,
        regalo_tipo: 'producto',
        regalo_producto_id: productoId,
      });

    it('sin eleccion queda pendiente (presentacionId null)', () => {
      expect(calcular([linea('pre-3', 10)], [completo('pro-1')])).toMatchObject([
        { productoId: 'pro-1', presentacionId: null, cantidad: 1 },
      ]);
    });

    it('con la eleccion del vendedor, en la elegida', () => {
      const elecciones = new Map([['promo-completo', 'pre-2']]);
      expect(calcular([linea('pre-3', 10)], [completo('pro-1')], elecciones)).toMatchObject([
        { productoId: 'pro-1', presentacionId: 'pre-2' },
      ]);
    });

    it('una eleccion de otro producto no vale', () => {
      const elecciones = new Map([['promo-completo', 'pre-3']]);
      expect(calcular([linea('pre-3', 10)], [completo('pro-1')], elecciones)).toMatchObject([
        { presentacionId: null },
      ]);
    });

    it('con una sola presentacion en el catalogo, esa sin eleccion', () => {
      expect(calcular([linea('pre-1', 10)], [completo('pro-2')])).toMatchObject([
        { productoId: 'pro-2', presentacionId: 'pre-3' },
      ]);
    });
  });

  it('las elecciones solo cuentan para el regalo de producto completo', () => {
    const p = promo({
      compra_tipo: 'cualquiera',
      compra_producto_id: null,
      regalo_tipo: 'presentacion',
      regalo_presentacion_id: 'pre-1',
    });
    const elecciones = new Map([
      [p.id, 'pre-2'],
      ['promo-otra', 'pre-2'],
    ]);
    expect(calcular([linea('pre-1', 10)], [p], elecciones)).toMatchObject([{ presentacionId: 'pre-1' }]);
    expect(calcular([linea('pre-1', 6), linea('pre-2', 4)], [promo()], elecciones)).toMatchObject([
      { presentacionId: 'pre-1' },
    ]);
  });

  it('dos promociones a la misma presentacion dan dos regalos', () => {
    const otra = promo({
      id: 'promo-otra',
      compra_tipo: 'cualquiera',
      compra_producto_id: null,
      compra_cantidad: 20,
      regalo_tipo: 'presentacion',
      regalo_presentacion_id: 'pre-1',
    });
    expect(calcular([linea('pre-1', 20)], [promo(), otra])).toMatchObject([
      { promocionId: 'promo-general', presentacionId: 'pre-1', cantidad: 2 },
      { promocionId: 'promo-otra', presentacionId: 'pre-1', cantidad: 1 },
    ]);
  });

  it('prospecto con compra 0: regalo aunque no haya cantidades, una sola vez', () => {
    const esperado = [
      {
        promocionId: 'promo-prospecto',
        texto: 'Bienvenida al prospecto: 2 Jamaica 500 ml gratis en su primera venta',
        productoId: 'pro-1',
        presentacionId: 'pre-2',
        cantidad: 2,
      },
    ];
    expect(calcular([], [prospecto()])).toEqual(esperado);
    expect(calcular([linea('pre-1', 0), linea('pre-2', 0)], [prospecto()])).toEqual(esperado);
    expect(calcular([linea('pre-1', 100)], [prospecto()])).toEqual(esperado);
  });

  it('una cantidad NaN cuenta como 0 y no revienta', () => {
    expect(() => calcular([linea('pre-1', Number.NaN)], [promo()])).not.toThrow();
    expect(calcular([linea('pre-1', Number.NaN)], [promo()])).toEqual([]);
    expect(calcular([linea('pre-1', Number.NaN), linea('pre-2', 10)], [promo()])).toMatchObject([
      { presentacionId: 'pre-2', cantidad: 1 },
    ]);
  });

  it('un regalo a una presentacion fuera del catalogo se omite', () => {
    const regaloFuera = promo({
      compra_tipo: 'cualquiera',
      compra_producto_id: null,
      regalo_tipo: 'presentacion',
      regalo_presentacion_id: 'pre-9',
    });
    expect(calcular([linea('pre-1', 30)], [regaloFuera])).toEqual([]);
    const compraFuera = promo({ compra_tipo: 'presentacion', compra_producto_id: null, compra_presentacion_id: 'pre-9' });
    expect(calcular([linea('pre-9', 30), linea('pre-1', 30)], [compraFuera])).toEqual([]);
  });
});

describe('aplicarRegalos (D6)', () => {
  const regalo = (extra: Partial<Regalo> = {}): Regalo => ({
    promocionId: 'promo-general',
    texto: 'Por cada 10 Jamaica, 1 Jamaica gratis',
    productoId: 'pro-1',
    presentacionId: 'pre-1',
    cantidad: 2,
    ...extra,
  });
  const otro = regalo({ promocionId: 'promo-otra', cantidad: 1 });

  it('rellena cantidadPromocion con la suma de los regalos de cada linea', () => {
    const lineas = [{ ...linea('pre-1', 20), cantidadPromocion: 7 }, linea('pre-2', 3)];
    const r = aplicarRegalos(lineas, [regalo(), otro], new Set());
    expect(r.lineas.map((l) => [l.presentacionId, l.cantidadPromocion])).toEqual([
      ['pre-1', 3],
      ['pre-2', 0],
    ]);
    expect(r.regalos).toEqual([regalo(), otro]);
  });

  it('un regalo descartado no suma ni se devuelve', () => {
    const r = aplicarRegalos([linea('pre-1', 20)], [regalo(), otro], new Set(['promo-general']));
    expect(r.lineas[0]?.cantidadPromocion).toBe(1);
    expect(r.regalos).toEqual([otro]);
  });

  it('un regalo sin presentacion no suma pero se devuelve', () => {
    const pendiente = regalo({ presentacionId: null });
    const r = aplicarRegalos([linea('pre-1', 20)], [pendiente], new Set());
    expect(r.lineas[0]?.cantidadPromocion).toBe(0);
    expect(r.regalos).toEqual([pendiente]);
  });

  it('crea la linea de una presentacion regalada que no esta entre las lineas', () => {
    const bienvenida = regalo({ promocionId: 'promo-prospecto', presentacionId: 'pre-2', cantidad: 2 });
    const r = aplicarRegalos([linea('pre-1', 0)], [bienvenida], new Set());
    expect(r.lineas).toEqual([
      linea('pre-1', 0),
      { presentacionId: 'pre-2', etiqueta: '', cantidad: 0, cantidadPromocion: 2, precioCentavos: null },
    ]);
  });

  it('no muta las entradas', () => {
    const lineas = [linea('pre-1', 20)];
    const regalos = [regalo(), regalo({ presentacionId: 'pre-3' })];
    const copiaLineas = structuredClone(lineas);
    const copiaRegalos = structuredClone(regalos);
    const r = aplicarRegalos(lineas, regalos, new Set());
    expect(lineas).toEqual(copiaLineas);
    expect(regalos).toEqual(copiaRegalos);
    expect(r.lineas[0]).not.toBe(lineas[0]);
    expect(r.regalos).not.toBe(regalos);
  });
});

describe('problemasDeRegalos (D16)', () => {
  it('sin problemas cuando todos tienen presentacion', () => {
    expect(
      problemasDeRegalos([
        { promocionId: 'p', texto: 'x', productoId: 'pro-1', presentacionId: 'pre-1', cantidad: 1 },
      ]),
    ).toEqual([]);
  });

  it('pide elegir la presentacion de cada regalo pendiente', () => {
    const texto = 'Por cada pieza, 1 Jamaica gratis';
    expect(
      problemasDeRegalos([
        { promocionId: 'p1', texto, productoId: 'pro-1', presentacionId: null, cantidad: 1 },
        { promocionId: 'p2', texto: 'otra', productoId: 'pro-1', presentacionId: 'pre-1', cantidad: 1 },
        { promocionId: 'p3', texto: 'Al comprar 5 Horchata, 1 Horchata gratis (una vez)', productoId: 'pro-2', presentacionId: null, cantidad: 1 },
      ]),
    ).toEqual([
      'Elige la presentación del regalo de «Por cada pieza, 1 Jamaica gratis».',
      'Elige la presentación del regalo de «Al comprar 5 Horchata, 1 Horchata gratis (una vez)».',
    ]);
  });
});
