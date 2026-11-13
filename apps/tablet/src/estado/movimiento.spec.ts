import {
  capturar,
  crearGuardiaRegistro,
  faltantesVisiblesMovimiento,
  MENSAJE_DIA_CERRADO_MOVIMIENTO,
  MENSAJE_FALTA_RECIBIDO,
  ofreceConsumo,
  pastillaMovimiento,
  piezasCapturadas,
  resumenMovimiento,
  tipoDeCaptura,
  TITULO_MOVIMIENTO,
  validarCapturaMovimiento,
  type EntradaCapturaMovimiento,
} from './movimiento';

/** Lo que deciden las pantallas de merma y consumo (T-27 pieza 2), sin React. */

const entrada = (extra: Partial<EntradaCapturaMovimiento> = {}): EntradaCapturaMovimiento => ({
  tipo: 'merma_cliente',
  clienteId: 'cli-1',
  captura: { 'pre-1': { recibido: '3' }, 'pre-2': { entregado: '2' } },
  comentario: '',
  diaCerrado: false,
  ...extra,
});

describe('validarCapturaMovimiento', () => {
  it('convierte los campos en lineas: lo vacio o en 0 no cuenta', () => {
    const v = validarCapturaMovimiento(
      entrada({ captura: { 'pre-1': { recibido: '3', entregado: '0' }, 'pre-2': { recibido: '', entregado: '2' } } }),
    );
    expect(v).toEqual({
      lineas: [
        { presentacionId: 'pre-1', sentido: 'recibido', piezas: 3 },
        { presentacionId: 'pre-2', sentido: 'entregado', piezas: 2 },
      ],
      comentario: null,
      faltantes: [],
      listo: true,
    });
  });

  it('Review Focus 3: solo con "Le entregué" no queda lista', () => {
    const v = validarCapturaMovimiento(entrada({ captura: { 'pre-2': { entregado: '2' } } }));
    expect(v.listo).toBe(false);
    expect(v.faltantes).toEqual([MENSAJE_FALTA_RECIBIDO]);
  });

  it('una cantidad ilegible lo dice y no queda lista', () => {
    const v = validarCapturaMovimiento(entrada({ captura: { 'pre-1': { recibido: '3a' } } }));
    expect(v.faltantes).toContain('Las piezas son números enteros de 1 a 99999.');
    expect(v.listo).toBe(false);
  });

  it('el comentario se recorta; vacio es null', () => {
    expect(validarCapturaMovimiento(entrada({ comentario: '  Reventadas  ' })).comentario).toBe('Reventadas');
  });

  it('con el dia cerrado no queda lista', () => {
    expect(validarCapturaMovimiento(entrada({ diaCerrado: true })).faltantes).toEqual([MENSAJE_DIA_CERRADO_MOVIMIENTO]);
  });

  it('Review Focus 1: con límite 0 no se ofrece consumo; agotado, la captura no queda lista', () => {
    expect(ofreceConsumo(0)).toBe(false);
    expect(ofreceConsumo(1)).toBe(true);
    const consumo = (consumoDeHoy: number, piezas: string) =>
      validarCapturaMovimiento(
        entrada({
          tipo: 'consumo',
          clienteId: null,
          captura: { 'pre-1': { entregado: piezas } },
          consumo: { limite: 1, consumoDeHoy },
        }),
      );
    expect(consumo(0, '1').listo).toBe(true);
    expect(consumo(1, '1').faltantes).toEqual(['Ya registraste tu consumo de hoy.']);
    expect(consumo(0, '2').faltantes).toEqual(['Te quedan 1 de consumo hoy; no puedes registrar 2.']);
  });

  it('el trayecto sin piezas no queda listo', () => {
    expect(
      validarCapturaMovimiento(entrada({ tipo: 'merma_trayecto', clienteId: null, captura: {} })).faltantes,
    ).toEqual(['Captura al menos una pieza.']);
  });
});

describe('captura', () => {
  it('capturar no muta y conserva el otro campo de la presentacion', () => {
    const antes = { 'pre-1': { recibido: '3' } };
    const despues = capturar(antes, 'pre-1', 'entregado', '2');
    expect(antes).toEqual({ 'pre-1': { recibido: '3' } });
    expect(despues).toEqual({ 'pre-1': { recibido: '3', entregado: '2' } });
    expect(piezasCapturadas(despues, 'pre-1', 'entregado')).toBe(2);
    expect(piezasCapturadas(despues, 'pre-2', 'entregado')).toBe(0);
    expect(piezasCapturadas({ 'pre-1': { entregado: 'x' } }, 'pre-1', 'entregado')).toBe(0);
  });

  it('los faltantes se ven solo cuando el vendedor ya empezo', () => {
    const vacia = entrada({ captura: {} });
    expect(faltantesVisiblesMovimiento(vacia, validarCapturaMovimiento(vacia))).toEqual([]);
    const empezada = entrada({ captura: { 'pre-2': { entregado: '2' } } });
    expect(faltantesVisiblesMovimiento(empezada, validarCapturaMovimiento(empezada))).toEqual([MENSAJE_FALTA_RECIBIDO]);
  });

  it('tipoDeCaptura acepta solo los dos tipos del menu', () => {
    expect(tipoDeCaptura('merma_trayecto')).toBe('merma_trayecto');
    expect(tipoDeCaptura('consumo')).toBe('consumo');
    expect(tipoDeCaptura('merma_cliente')).toBeNull();
    expect(tipoDeCaptura(undefined)).toBeNull();
    expect(tipoDeCaptura(['consumo'])).toBeNull();
  });
});

describe('lista de movimientos', () => {
  it('titulos por tipo', () => {
    expect(TITULO_MOVIMIENTO).toEqual({
      merma_cliente: 'Merma del cliente',
      merma_trayecto: 'Merma del trayecto',
      consumo: 'Consumo propio',
    });
  });

  it('pastillaMovimiento: por subir, subido o rechazado con su motivo', () => {
    expect(pastillaMovimiento({ sync_estado: 'pendiente', sync_error: null })).toEqual({
      texto: 'por subir',
      estado: 'pendiente',
      detalle: null,
    });
    expect(pastillaMovimiento({ sync_estado: 'sincronizado', sync_error: null }).texto).toBe('subido');
    expect(
      pastillaMovimiento({ sync_estado: 'error', sync_error: 'datos-invalidos: lineas: la presentación no existe.' }),
    ).toEqual({ texto: 'rechazado', estado: 'error', detalle: 'lineas: la presentación no existe.' });
  });

  it('resumenMovimiento: lo recibido y lo entregado de la merma; las piezas del resto', () => {
    const linea = (etiqueta: string, sentido: 'recibido' | 'entregado', piezas: number) => ({
      movimiento_id: 'm',
      presentacion_id: etiqueta,
      etiqueta,
      sentido,
      piezas,
    });
    expect(
      resumenMovimiento({
        tipo: 'merma_cliente',
        lineas: [linea('Jamaica 1 L', 'recibido', 3), linea('Jamaica 500 ml', 'entregado', 2)],
      }),
    ).toBe('Recibí dañado: Jamaica 1 L ×3 · Le entregué: Jamaica 500 ml ×2');
    expect(resumenMovimiento({ tipo: 'merma_cliente', lineas: [linea('Jamaica 1 L', 'recibido', 3)] })).toBe(
      'Recibí dañado: Jamaica 1 L ×3',
    );
    expect(
      resumenMovimiento({
        tipo: 'consumo',
        lineas: [linea('Jamaica 1 L', 'entregado', 1), linea('Jamaica 500 ml', 'entregado', 1)],
      }),
    ).toBe('Jamaica 1 L ×1, Jamaica 500 ml ×1');
  });
});

describe('crearGuardiaRegistro (doble toque)', () => {
  it('un segundo toque no vuelve a grabar', () => {
    const guardia = crearGuardiaRegistro();
    const grabar = jest.fn(() => 'grabado');
    expect(guardia.intentar(grabar)).toBe('grabado');
    expect(guardia.intentar(grabar)).toBeNull();
    expect(grabar).toHaveBeenCalledTimes(1);
  });

  it('si grabar falla, la guardia se suelta para reintentar', () => {
    const guardia = crearGuardiaRegistro();
    expect(() =>
      guardia.intentar(() => {
        throw new Error('Ya registraste tu consumo de hoy.');
      }),
    ).toThrow('Ya registraste tu consumo de hoy.');
    expect(guardia.intentar(() => 'segunda')).toBe('segunda');
  });
});
