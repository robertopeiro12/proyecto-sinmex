import {
  capturar,
  crearGuardiaRegistro,
  detalleMovimiento,
  ETIQUETA_TIPO_MOVIMIENTO,
  filtrarMovimientos,
  FILTROS_MOVIMIENTOS,
  lugarMovimiento,
  piezasDelMovimiento,
  piezasDelSentido,
  renglonesCapturados,
  renglonesMovimiento,
  textoMovimientos,
  textoPestana,
  textoPiezasBarra,
  textoPzas,
  TIPO_DE_PESTANA,
  topeTeclado,
  totalPiezasDelDia,
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
  motivoMermaId: 'mm-1',
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
          motivoMermaId: null,
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
      merma_trayecto: 'Merma del vehículo',
      consumo: 'Consumo propio',
      cambio: 'Cambio',
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
    ).toBe('Me entregó dañado: Jamaica 1 L ×3 · Le entregué: Jamaica 500 ml ×2');
    expect(resumenMovimiento({ tipo: 'merma_cliente', lineas: [linea('Jamaica 1 L', 'recibido', 3)] })).toBe(
      'Me entregó dañado: Jamaica 1 L ×3',
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

/** Rediseño pieza 4: Merma y cambios (maquetas 14, 15 y 16). */
const linea = (etiqueta: string, sentido: 'recibido' | 'entregado', piezas: number) => ({
  movimiento_id: 'm',
  presentacion_id: etiqueta,
  etiqueta,
  sentido,
  piezas,
});

const mov = (
  id: string,
  tipo: 'merma_cliente' | 'merma_trayecto' | 'consumo' | 'cambio',
  lineas: ReturnType<typeof linea>[],
  motivo_nombre: string | null = null,
) => ({ id, tipo, lineas, motivo_nombre });

describe('resumenMovimiento del cambio', () => {
  it('"Fresa por Mango": lo que regreso el cliente por lo que se llevo, sin repetir', () => {
    expect(
      resumenMovimiento({ tipo: 'cambio', lineas: [linea('Fresa 500 ml', 'recibido', 6), linea('Mango 500 ml', 'entregado', 6)] }),
    ).toBe('Fresa por Mango');
    expect(
      resumenMovimiento({
        tipo: 'cambio',
        lineas: [
          linea('Fresa 500 ml', 'recibido', 2),
          linea('Jamaica 1 L', 'recibido', 1),
          linea('Mango 500 ml', 'entregado', 3),
        ],
      }),
    ).toBe('Fresa, Jamaica por Mango');
  });

  it('con dos presentaciones del mismo producto conserva el volumen para distinguirlas', () => {
    expect(
      resumenMovimiento({
        tipo: 'cambio',
        lineas: [linea('Fresa 500 ml', 'recibido', 2), linea('Fresa 1 L', 'entregado', 2), linea('Mango 1 L', 'entregado', 1)],
      }),
    ).toBe('Fresa 500 ml por Fresa 1 L, Mango');
  });
});

describe('registro de Merma / Cambios (maqueta 15)', () => {
  const merma = mov('a', 'merma_cliente', [linea('Jamaica 1 L', 'recibido', 3), linea('Horchata 500 ml', 'recibido', 2), linea('Jamaica 1 L', 'entregado', 3)], 'Caducado');
  const vehiculo = mov('b', 'merma_trayecto', [linea('Horchata 1 L', 'entregado', 2), linea('Jamaica 1 L', 'entregado', 2)], 'Envase roto');
  const cambio = mov('c', 'cambio', [linea('Fresa 500 ml', 'recibido', 6), linea('Mango 500 ml', 'entregado', 6)]);
  const consumo = mov('d', 'consumo', [linea('Jamaica 1 L', 'entregado', 1)]);
  const todos = [merma, vehiculo, cambio, consumo];

  it('filtros Todo / Merma / Cambios: el consumo solo en Todo; conserva el orden', () => {
    expect(FILTROS_MOVIMIENTOS.map((f) => f.etiqueta)).toEqual(['Todo', 'Merma', 'Cambios']);
    expect(filtrarMovimientos(todos, 'todo').map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filtrarMovimientos(todos, 'merma').map((m) => m.id)).toEqual(['a', 'b']);
    expect(filtrarMovimientos(todos, 'cambios').map((m) => m.id)).toEqual(['c']);
    expect(filtrarMovimientos([], 'merma')).toEqual([]);
  });

  it('piezas: con cliente, lo que entrego el cliente; sin cliente, lo que salio', () => {
    expect(piezasDelMovimiento(merma)).toBe(5);
    expect(piezasDelMovimiento(vehiculo)).toBe(4);
    expect(piezasDelMovimiento(cambio)).toBe(6);
    expect(piezasDelMovimiento(consumo)).toBe(1);
    expect(totalPiezasDelDia(todos)).toBe(16);
    expect(totalPiezasDelDia([])).toBe(0);
  });

  it('textos de la tarjeta y del renglon', () => {
    expect(textoMovimientos(1)).toBe('1 movimiento');
    expect(textoMovimientos(4)).toBe('4 movimientos');
    expect(textoPzas(1)).toBe('1 pza');
    expect(textoPzas(15)).toBe('15 pzas');
    expect(lugarMovimiento('Tienda Doña Chuy')).toBe('Tienda Doña Chuy');
    expect(lugarMovimiento(null)).toBe('Vehículo');
    expect(ETIQUETA_TIPO_MOVIMIENTO).toEqual({
      merma_cliente: 'Merma',
      merma_trayecto: 'Merma',
      consumo: 'Consumo',
      cambio: 'Cambio',
    });
  });

  it('detalle: el motivo de la merma; el resumen en el cambio, el consumo y la merma sin motivo', () => {
    expect(detalleMovimiento(vehiculo)).toBe('Envase roto');
    expect(detalleMovimiento(cambio)).toBe('Fresa por Mango');
    expect(detalleMovimiento(consumo)).toBe('Jamaica 1 L ×1');
    expect(detalleMovimiento({ ...merma, motivo_nombre: null })).toBe(
      'Me entregó dañado: Jamaica 1 L ×3, Horchata 500 ml ×2 · Le entregué: Jamaica 1 L ×3',
    );
  });
});

describe('captura de Merma y cambios (maquetas 14 y 16)', () => {
  it('cada pestaña graba su tipo y cuenta lo que entrego el cliente', () => {
    expect(TIPO_DE_PESTANA).toEqual({ merma: 'merma_cliente', cambios: 'cambio' });
    const captura = { 'pre-1': { recibido: '3', entregado: '3' }, 'pre-2': { recibido: '2' } };
    expect(piezasDelSentido(captura, 'recibido')).toBe(5);
    expect(piezasDelSentido(captura, 'entregado')).toBe(3);
    expect(textoPestana('merma', captura)).toBe('Merma · 5');
    expect(textoPestana('cambios', {})).toBe('Cambios · 0');
    expect(piezasDelSentido({ 'pre-1': { recibido: 'x' } }, 'recibido')).toBe(0);
  });

  it('renglonesMovimiento: orden de la venta (producto y volumen) y "te quedan" solo con control', () => {
    const presentaciones = [
      { presentacionId: 'j1', etiqueta: 'Jamaica · 1 L' },
      { presentacionId: 'j5', etiqueta: 'Jamaica · 500 ml' },
      { presentacionId: 'a5', etiqueta: 'Arándano · 500 ml' },
    ];
    const existencias = new Map([['j1', { existencia: 9 }]]);
    expect(renglonesMovimiento({ presentaciones, existencias, controlInventario: true })).toEqual([
      { presentacionId: 'a5', etiqueta: 'Arándano · 500 ml', quedan: 0 },
      { presentacionId: 'j5', etiqueta: 'Jamaica · 500 ml', quedan: 0 },
      { presentacionId: 'j1', etiqueta: 'Jamaica · 1 L', quedan: 9 },
    ]);
    expect(
      renglonesMovimiento({ presentaciones, existencias, controlInventario: false }).map((r) => r.quedan),
    ).toEqual([null, null, null]);
  });

  it('renglonesCapturados: solo los de ese lado con piezas, en el orden de la lista', () => {
    const renglones = [
      { presentacionId: 'a', etiqueta: 'A', quedan: null },
      { presentacionId: 'b', etiqueta: 'B', quedan: null },
      { presentacionId: 'c', etiqueta: 'C', quedan: null },
    ];
    const captura = { c: { recibido: '2' }, a: { recibido: '1', entregado: '4' }, b: { recibido: '' } };
    expect(renglonesCapturados(renglones, captura, 'recibido').map((r) => r.presentacionId)).toEqual(['a', 'c']);
    expect(renglonesCapturados(renglones, captura, 'entregado').map((r) => r.presentacionId)).toEqual(['a']);
  });

  it('topeTeclado: lo recibido hasta el maximo; lo que sale, hasta lo que queda', () => {
    expect(topeTeclado('recibido', 3)).toBe(99_999);
    expect(topeTeclado('entregado', null)).toBe(99_999);
    expect(topeTeclado('entregado', 8)).toBe(8);
    expect(topeTeclado('entregado', -2)).toBe(0);
  });

  it('textoPiezasBarra', () => {
    expect(textoPiezasBarra(4)).toBe('4 PIEZAS');
    expect(textoPiezasBarra(1)).toBe('1 PIEZA');
  });
});
