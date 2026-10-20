import {
  bloqueoDeVenta,
  cargaPendiente,
  existencias,
  faltantesDeVenta,
  MOTIVO_CARGA_PENDIENTE,
  textoFaltante,
  type CargaInventario,
  type LineaVentaInventario,
} from './inventario-reglas';

/**
 * El inventario del vendedor (T-27 pieza 1), sin SQLite: lo que trae
 * (cargas aceptadas de hoy) menos lo que vendio y regalo hoy.
 */

const HOY = '2026-10-22';

function carga(extra: Partial<CargaInventario> = {}): CargaInventario {
  return {
    id: 'c-1',
    fecha: HOY,
    numero: 1,
    estado: 'aceptada',
    activo: 1,
    lineas: [{ presentacion_id: 'horchata', piezas: 20 }],
    ...extra,
  };
}

function venta(extra: Partial<LineaVentaInventario> = {}): LineaVentaInventario {
  return { fecha: HOY, presentacion_id: 'horchata', cantidad: 5, cantidad_promocion: 1, ...extra };
}

describe('existencias', () => {
  it('cargado − vendido − regalado, solo con cargas aceptadas, vivas y de hoy', () => {
    const e = existencias(
      [
        carga(),
        carga({ id: 'c-2', numero: 2, lineas: [{ presentacion_id: 'horchata', piezas: 10 }, { presentacion_id: 'jamaica', piezas: 6 }] }),
        carga({ id: 'c-3', numero: 3, estado: 'pendiente' }),
        carga({ id: 'c-4', numero: 4, estado: 'rechazada' }),
        carga({ id: 'c-5', numero: 5, activo: 0 }),
        carga({ id: 'c-6', fecha: '2026-10-21' }),
      ],
      [venta(), venta({ cantidad: 3, cantidad_promocion: 0 }), venta({ fecha: '2026-10-21', cantidad: 50 })],
      HOY,
    );
    expect(e.get('horchata')).toEqual({ cargado: 30, vendido: 8, regalado: 1, existencia: 21 });
    expect(e.get('jamaica')).toEqual({ cargado: 6, vendido: 0, regalado: 0, existencia: 6 });
  });

  it('lo vendido sin carga queda en negativo (venta con el control apagado)', () => {
    expect(existencias([], [venta({ presentacion_id: 'tamarindo', cantidad: 4, cantidad_promocion: 0 })], HOY).get('tamarindo')).toEqual({
      cargado: 0,
      vendido: 4,
      regalado: 0,
      existencia: -4,
    });
  });
});

describe('cargaPendiente', () => {
  it('la pendiente viva de hoy de menor numero', () => {
    const pendientes = [
      carga({ id: 'c-3', numero: 3, estado: 'pendiente' }),
      carga({ id: 'c-2', numero: 2, estado: 'pendiente' }),
      carga({ id: 'c-1', numero: 1 }),
    ];
    expect(cargaPendiente(pendientes, HOY)?.id).toBe('c-2');
  });

  it('ni una dada de baja ni una de ayer cuentan', () => {
    expect(
      cargaPendiente(
        [
          carga({ estado: 'pendiente', activo: 0 }),
          carga({ id: 'c-2', estado: 'pendiente', fecha: '2026-10-21' }),
        ],
        HOY,
      ),
    ).toBeNull();
  });
});

describe('bloqueoDeVenta (D3)', () => {
  it('con el control prendido y una carga pendiente de hoy: "Tienes una carga por aceptar"', () => {
    expect(bloqueoDeVenta({ controlInventario: true, cargas: [carga({ estado: 'pendiente' })], hoy: HOY })).toBe(
      MOTIVO_CARGA_PENDIENTE,
    );
    expect(MOTIVO_CARGA_PENDIENTE).toBe('Tienes una carga por aceptar');
  });

  it('sin pendiente no bloquea', () => {
    expect(bloqueoDeVenta({ controlInventario: true, cargas: [carga()], hoy: HOY })).toBeNull();
  });
});

describe('faltantesDeVenta (D4, D10)', () => {
  const disponibles = existencias([carga()], [], HOY);

  it('cuentan las piezas vendidas MAS las regaladas', () => {
    expect(
      faltantesDeVenta({
        controlInventario: true,
        existencias: disponibles,
        lineas: [{ presentacionId: 'horchata', cantidad: 20 }],
        regalos: [{ presentacionId: 'horchata', cantidad: 2 }],
      }),
    ).toEqual([{ presentacionId: 'horchata', faltan: 2 }]);
  });

  it('lo que alcanza no falta; lo que no se cargo falta completo; una existencia negativa cuenta como 0', () => {
    const conNegativa = existencias([carga()], [venta({ presentacion_id: 'jamaica', cantidad: 3, cantidad_promocion: 0 })], HOY);
    expect(
      faltantesDeVenta({
        controlInventario: true,
        existencias: conNegativa,
        lineas: [
          { presentacionId: 'horchata', cantidad: 20 },
          { presentacionId: 'jamaica', cantidad: 1 },
          { presentacionId: 'tamarindo', cantidad: 0 },
        ],
        regalos: [{ presentacionId: 'limonada', cantidad: 2 }],
      }),
    ).toEqual([
      { presentacionId: 'jamaica', faltan: 1 },
      { presentacionId: 'limonada', faltan: 2 },
    ]);
  });

  it('una venta de solo regalo tambien necesita piezas (D10)', () => {
    expect(
      faltantesDeVenta({
        controlInventario: true,
        existencias: new Map(),
        lineas: [],
        regalos: [{ presentacionId: 'horchata', cantidad: 2 }],
      }),
    ).toEqual([{ presentacionId: 'horchata', faltan: 2 }]);
  });

  it('una cantidad ilegible (NaN) no cuenta como pedida', () => {
    expect(
      faltantesDeVenta({
        controlInventario: true,
        existencias: new Map(),
        lineas: [{ presentacionId: 'horchata', cantidad: Number.NaN }],
        regalos: [],
      }),
    ).toEqual([]);
  });

  it('textoFaltante, en singular y plural', () => {
    expect(textoFaltante('Horchata 1 L', 3)).toBe('Horchata 1 L: faltan 3 piezas');
    expect(textoFaltante('Horchata 1 L', 1)).toBe('Horchata 1 L: falta 1 pieza');
  });
});

describe('Review Focus 5: con el control apagado no hay bloqueo ni faltantes', () => {
  it('aunque haya una carga pendiente y la venta pase lo que trae', () => {
    expect(bloqueoDeVenta({ controlInventario: false, cargas: [carga({ estado: 'pendiente' })], hoy: HOY })).toBeNull();
    expect(
      faltantesDeVenta({
        controlInventario: false,
        existencias: new Map(),
        lineas: [{ presentacionId: 'horchata', cantidad: 500 }],
        regalos: [{ presentacionId: 'horchata', cantidad: 50 }],
      }),
    ).toEqual([]);
  });
});
