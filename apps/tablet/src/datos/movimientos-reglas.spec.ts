import {
  consumoRestante,
  LARGO_MAX_COMENTARIO_MOVIMIENTO,
  MENSAJE_CONSUMO_AGOTADO,
  MENSAJE_FALTA_RECIBIDO,
  MENSAJE_SIN_CONSUMO,
  MENSAJE_SIN_PIEZAS,
  motivoDeConsumo,
  textoConsumoRestante,
  validarMovimiento,
  type EntradaMovimiento,
} from './movimientos-reglas';

/** La forma de un movimiento y el limite de consumo (T-27 pieza 2), sin SQLite. */

const merma = (extra: Partial<EntradaMovimiento> = {}): EntradaMovimiento => ({
  tipo: 'merma_cliente',
  clienteId: 'cli-1',
  comentario: null,
  lineas: [
    { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
    { presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 },
  ],
  ...extra,
});

const trayecto = (extra: Partial<EntradaMovimiento> = {}): EntradaMovimiento => ({
  tipo: 'merma_trayecto',
  clienteId: null,
  comentario: null,
  lineas: [{ presentacionId: 'pre-1', sentido: 'entregado', piezas: 1 }],
  ...extra,
});

describe('validarMovimiento', () => {
  it('una merma del cliente con lo recibido y la reposicion es valida; tambien sin reposicion', () => {
    expect(validarMovimiento(merma())).toEqual([]);
    expect(validarMovimiento(merma({ lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 1 }] }))).toEqual([]);
  });

  it('Review Focus 3: merma del cliente sin lo recibido', () => {
    expect(
      validarMovimiento(merma({ lineas: [{ presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 }] })),
    ).toEqual([MENSAJE_FALTA_RECIBIDO]);
    expect(validarMovimiento(merma({ lineas: [] }))).toEqual([MENSAJE_FALTA_RECIBIDO]);
    expect(MENSAJE_FALTA_RECIBIDO).toBe('Captura al menos una pieza en «Recibí dañado».');
  });

  it('la merma del cliente necesita al cliente; el trayecto y el consumo no lo llevan', () => {
    expect(validarMovimiento(merma({ clienteId: null }))).toEqual(['La merma del cliente necesita al cliente.']);
    expect(validarMovimiento(trayecto({ tipo: 'consumo', clienteId: 'cli-1' }))).toEqual([
      'La merma del trayecto y el consumo no llevan cliente.',
    ]);
  });

  it('el trayecto y el consumo: al menos una pieza, y solo piezas que salen', () => {
    expect(validarMovimiento(trayecto())).toEqual([]);
    expect(validarMovimiento(trayecto({ lineas: [] }))).toEqual([MENSAJE_SIN_PIEZAS]);
    expect(
      validarMovimiento(trayecto({ lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 1 }] })),
    ).toEqual(['Aquí solo se registran piezas que salen de la camioneta.']);
  });

  it('piezas fuera de rango, presentacion repetida y comentario largo', () => {
    expect(
      validarMovimiento(merma({ lineas: [{ presentacionId: 'pre-1', sentido: 'recibido', piezas: 0 }] })),
    ).toEqual(['Las piezas de cada producto van de 1 a 99999.']);
    expect(
      validarMovimiento(trayecto({ lineas: [{ presentacionId: 'pre-1', sentido: 'entregado', piezas: 1.5 }] })),
    ).toEqual(['Las piezas de cada producto van de 1 a 99999.']);
    expect(
      validarMovimiento(
        merma({
          lineas: [
            { presentacionId: 'pre-1', sentido: 'recibido', piezas: 1 },
            { presentacionId: 'pre-1', sentido: 'recibido', piezas: 2 },
          ],
        }),
      ),
    ).toEqual(['La misma presentación viene dos veces.']);
    expect(validarMovimiento(merma({ comentario: 'x'.repeat(LARGO_MAX_COMENTARIO_MOVIMIENTO + 1) }))).toEqual([
      'El comentario lleva hasta 300 caracteres.',
    ]);
  });
});

describe('consumo propio (D4)', () => {
  it('consumoRestante nunca es negativo', () => {
    expect(consumoRestante({ limite: 3, consumoDeHoy: 1 })).toBe(2);
    expect(consumoRestante({ limite: 1, consumoDeHoy: 4 })).toBe(0);
    expect(consumoRestante({ limite: 0, consumoDeHoy: 0 })).toBe(0);
  });

  it('Review Focus 1: motivoDeConsumo al límite y con límite 0', () => {
    expect(motivoDeConsumo({ limite: 1, consumoDeHoy: 0, piezas: 1 })).toBeNull();
    expect(motivoDeConsumo({ limite: 1, consumoDeHoy: 1, piezas: 1 })).toBe(MENSAJE_CONSUMO_AGOTADO);
    expect(MENSAJE_CONSUMO_AGOTADO).toBe('Ya registraste tu consumo de hoy');
    expect(motivoDeConsumo({ limite: 0, consumoDeHoy: 0, piezas: 1 })).toBe(MENSAJE_SIN_CONSUMO);
    expect(MENSAJE_SIN_CONSUMO).toBe('Tu sucursal no tiene consumo propio');
  });

  it('si no alcanza, dice cuánto queda', () => {
    expect(motivoDeConsumo({ limite: 3, consumoDeHoy: 2, piezas: 2 })).toBe(
      'Te quedan 1 de consumo hoy; no puedes registrar 2',
    );
    expect(textoConsumoRestante(2)).toBe('Te quedan 2 de consumo hoy');
  });
});
