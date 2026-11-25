import { existencias as existenciasDatos } from '@/datos/inventario-reglas';
import type { ResultadoApiCarga } from '@/sincronizacion/api-carga';
import type { CargaPull } from '@/sincronizacion/contrato';

import {
  aceptadasDe,
  alternarRenglon,
  crearRespondedorCarga,
  cuerpoRespuesta,
  existencias,
  faltantesDeCaptura,
  filasPorRegresar,
  MENSAJE_CARGA_CAMBIO,
  MENSAJE_CARGA_ELIMINADA,
  MENSAJE_SESION_CARGA,
  MENSAJE_SIN_RED_CARGA,
  pastillaCarga,
  puedeResponder,
  cambiosNetos,
  salio,
  textoCambios,
  seleccionarTodos,
  textoAceptar,
  textoEstadoCarga,
  textoTeQuedan,
  tituloAvisoCarga,
  todosSeleccionados,
  piezasDeCarga,
  totalPiezas,
  type PasosRespuestaCarga,
} from './inventario';

/**
 * Lo que las pantallas de inventario deciden sin React (T-27): la tablet no
 * tiene pruebas de componentes.
 */

const HOY = '2026-10-22';

const CARGA: CargaPull = {
  id: 'carga-1',
  vendedor_id: 'ven-1',
  fecha: HOY,
  numero: 1,
  estado: 'aceptada',
  motivo_rechazo: null,
  version: 1,
  respondida_en: '2026-10-22T15:00:00.000Z',
  activo: 1,
  lineas: [{ presentacion_id: 'pre-1', piezas: 24, aceptada: null }],
};

function pasos(respuestas: (ResultadoApiCarga | Error)[]) {
  const cola = [...respuestas];
  const p = {
    responder: jest.fn(async (): Promise<ResultadoApiCarga> => {
      const siguiente = cola.shift();
      if (!siguiente) throw new Error('sin mas respuestas');
      if (siguiente instanceof Error) throw siguiente;
      return siguiente;
    }),
    aplicar: jest.fn((_carga: CargaPull) => undefined),
    sincronizar: jest.fn(async () => undefined),
  };
  return p satisfies PasosRespuestaCarga;
}

describe('reexporta las reglas de la capa de datos', () => {
  it('existencias es la misma funcion', () => {
    expect(existencias).toBe(existenciasDatos);
  });
});

describe('la respuesta del vendedor (pieza 3: checklist sin motivo)', () => {
  it('el cuerpo lleva la version que se VE y los renglones aceptados; vacio rechaza', () => {
    expect(cuerpoRespuesta(3, ['pre-1', 'pre-2'])).toEqual({ version: 3, aceptadas: ['pre-1', 'pre-2'] });
    expect(cuerpoRespuesta(3, [])).toEqual({ version: 3, aceptadas: [] });
  });

  it('el cuerpo no comparte el arreglo que recibe', () => {
    const ids = ['pre-1'];
    const cuerpo = cuerpoRespuesta(1, ids);
    ids.push('pre-2');
    expect(cuerpo).toEqual({ version: 1, aceptadas: ['pre-1'] });
  });

  it('solo se responde una pendiente, viva y de hoy', () => {
    expect(puedeResponder({ estado: 'pendiente', activo: 1, fecha: HOY }, HOY)).toBe(true);
    expect(puedeResponder({ estado: 'aceptada', activo: 1, fecha: HOY }, HOY)).toBe(false);
    expect(puedeResponder({ estado: 'pendiente', activo: 0, fecha: HOY }, HOY)).toBe(false);
    expect(puedeResponder({ estado: 'pendiente', activo: 1, fecha: '2026-10-21' }, HOY)).toBe(false);
  });
});

describe('textos del inventario', () => {
  it('pastillaCarga y totalPiezas', () => {
    const l = (aceptada: 0 | 1 | null) => ({ aceptada });
    expect(pastillaCarga({ estado: 'pendiente', lineas: [l(null)] })).toEqual({ texto: 'Por aceptar', estado: 'pendiente' });
    expect(pastillaCarga({ estado: 'aceptada', lineas: [l(1), l(0)] })).toEqual({ texto: 'Aceptada 1 de 2', estado: 'listo' });
    expect(pastillaCarga({ estado: 'rechazada', lineas: [l(0)] })).toEqual({ texto: 'Rechazada', estado: 'error' });
    expect(pastillaCarga({ estado: 'aceptada', lineas: [l(0)] })).toEqual({ texto: 'Rechazada', estado: 'error' });
    expect(totalPiezas([{ piezas: 24 }, { piezas: 12 }])).toBe(36);
  });

  it('piezasDeCarga: aceptada cuenta solo lo que entro (D6); pendiente o rechazada, todo', () => {
    const lineas = [
      { piezas: 40, aceptada: 1 as const },
      { piezas: 30, aceptada: 1 as const },
      { piezas: 20, aceptada: 1 as const },
      { piezas: 10, aceptada: 0 as const },
    ];
    expect(piezasDeCarga({ estado: 'aceptada', lineas })).toBe(90);
    expect(piezasDeCarga({ estado: 'aceptada', lineas: [{ piezas: 5, aceptada: null }] })).toBe(5);
    expect(piezasDeCarga({ estado: 'pendiente', lineas: [{ piezas: 40, aceptada: null }, { piezas: 10 }] })).toBe(50);
    expect(piezasDeCarga({ estado: 'rechazada', lineas })).toBe(100);
  });

  it('textoEstadoCarga: Aceptada, Aceptada 3 de 5, Rechazada, Por aceptar', () => {
    const l = (aceptada: 0 | 1 | null) => ({ aceptada });
    expect(textoEstadoCarga({ estado: 'aceptada', lineas: [l(1), l(1)] })).toBe('Aceptada');
    expect(textoEstadoCarga({ estado: 'aceptada', lineas: [l(null), l(null)] })).toBe('Aceptada');
    expect(textoEstadoCarga({ estado: 'aceptada', lineas: [l(1), l(1), l(1), l(0), l(0)] })).toBe('Aceptada 3 de 5');
    expect(textoEstadoCarga({ estado: 'aceptada', lineas: [l(0), l(0)] })).toBe('Rechazada');
    expect(textoEstadoCarga({ estado: 'rechazada', lineas: [l(null)] })).toBe('Rechazada');
    expect(textoEstadoCarga({ estado: 'pendiente', lineas: [l(null)] })).toBe('Por aceptar');
  });

  it('"Te quedan N" descuenta lo capturado en esta venta; si no alcanza, dice cuanto falta', () => {
    expect(textoTeQuedan(20, 0)).toEqual({ texto: 'Te quedan 20', falta: false });
    expect(textoTeQuedan(20, 20)).toEqual({ texto: 'Te quedan 0', falta: false });
    expect(textoTeQuedan(20, 19)).toEqual({ texto: 'Te queda 1', falta: false });
    expect(textoTeQuedan(20, 21)).toEqual({ texto: 'Falta 1 pieza', falta: true });
    expect(textoTeQuedan(20, 26)).toEqual({ texto: 'Faltan 6 piezas', falta: true });
  });

  it('faltantesDeCaptura: textos para la revision, con regalos y sin los que no tienen presentacion', () => {
    const disponibles = existenciasDatos(
      [{ id: 'c', fecha: HOY, numero: 1, estado: 'aceptada', activo: 1, lineas: [{ presentacion_id: 'pre-1', piezas: 20 }] }],
      [],
      HOY,
    );
    expect(
      faltantesDeCaptura({
        controlInventario: true,
        existencias: disponibles,
        lineas: [
          { presentacionId: 'pre-1', etiqueta: 'Horchata 1 L', cantidad: 21 },
          { presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml', cantidad: Number.NaN },
        ],
        regalos: [
          { presentacionId: 'pre-1', cantidad: 2 },
          { presentacionId: null, cantidad: 5 },
        ],
      }),
    ).toEqual(['Horchata 1 L: faltan 3 piezas']);
    expect(
      faltantesDeCaptura({
        controlInventario: false,
        existencias: new Map(),
        lineas: [{ presentacionId: 'pre-1', etiqueta: 'Horchata 1 L', cantidad: 9 }],
        regalos: [],
      }),
    ).toEqual([]);
  });
});

describe('el checklist de la carga (pieza 3)', () => {
  const ids = ['pre-1', 'pre-2', 'pre-3'];

  it('alternarRenglon prende y apaga uno sin tocar el conjunto que recibe', () => {
    const vacio = new Set<string>();
    const uno = alternarRenglon(vacio, 'pre-2');
    expect([...uno]).toEqual(['pre-2']);
    expect(vacio.size).toBe(0);
    expect([...alternarRenglon(uno, 'pre-2')]).toEqual([]);
  });

  it('seleccionarTodos: si faltan, palomea todos; si ya estan todos, los quita', () => {
    expect([...seleccionarTodos(new Set(['pre-1']), ids)].sort()).toEqual(ids);
    expect([...seleccionarTodos(new Set(ids), ids)]).toEqual([]);
    expect(todosSeleccionados(new Set(ids), ids)).toBe(true);
    expect(todosSeleccionados(new Set(['pre-1']), ids)).toBe(false);
    expect(todosSeleccionados(new Set(), [])).toBe(false);
  });

  it('aceptadasDe: en el orden de la carga y solo los renglones que siguen en ella', () => {
    const lineas = ids.map((presentacion_id) => ({ presentacion_id }));
    expect(aceptadasDe(lineas, new Set(['pre-3', 'pre-1', 'pre-vieja']))).toEqual(['pre-1', 'pre-3']);
  });

  it('textoAceptar: "Aceptar 6 de 8"', () => {
    expect(textoAceptar(6, 8)).toBe('Aceptar 6 de 8');
  });
});

describe('el resumen de Inventario (maqueta 5)', () => {
  it('salio = cargado − existencia (vendido, regalado, mermas y consumo)', () => {
    expect(salio({ cargado: 48, existencia: 28 })).toBe(20);
    expect(salio({ cargado: 0, existencia: -4 })).toBe(4);
    // Un cambio que recibe mas de lo que entrega sube la existencia arriba de lo cargado.
    expect(salio({ cargado: 10, existencia: 13 })).toBe(0);
  });

  it('Cargado − Salió + Cambios = Existencia cuando hay cambios', () => {
    // Cargo 10, vendio 4, recibio 5 de cambio y entrego 1: existencia 10.
    const fila = { cargado: 10, existencia: 10, cambiosRecibidos: 5, cambiosEntregados: 1 };
    expect(cambiosNetos(fila)).toBe(4);
    expect(salio(fila)).toBe(4);
    expect(fila.cargado - salio(fila) + cambiosNetos(fila)).toBe(fila.existencia);
    // Entrega mas de lo que recibe: la existencia baja sin que sea venta.
    const otra = { cargado: 10, existencia: 5, cambiosRecibidos: 0, cambiosEntregados: 3 };
    expect(salio(otra)).toBe(2);
    expect(otra.cargado - salio(otra) + cambiosNetos(otra)).toBe(otra.existencia);
  });

  it('textoCambios: signo explicito', () => {
    expect(textoCambios(4)).toBe('+4');
    expect(textoCambios(-2)).toBe('−2');
    expect(textoCambios(0)).toBe('0');
  });

  it('tituloAvisoCarga: la primera es "Carga por aceptar", las demas "Recarga esperando"', () => {
    expect(tituloAvisoCarga({ numero: 1 })).toBe('Carga por aceptar');
    expect(tituloAvisoCarga({ numero: 2 })).toBe('Recarga esperando');
  });
});

describe('crearRespondedorCarga', () => {
  it('200: aplica la carga que contesto el servidor y el candado se queda cerrado', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'ok', carga: CARGA }]);
    await expect(respondedor.responder(p)).resolves.toEqual({ estado: 'respondida', carga: CARGA });
    expect(p.aplicar).toHaveBeenCalledWith(CARGA);
    expect(p.sincronizar).not.toHaveBeenCalled();
    await expect(respondedor.responder(pasos([{ tipo: 'ok', carga: CARGA }]))).resolves.toBeNull();
  });

  it('Review Focus 3: dos toques seguidos llaman una sola vez al servidor', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'ok', carga: CARGA }]);
    const [primero, segundo] = await Promise.all([respondedor.responder(p), respondedor.responder(p)]);
    expect(primero).toEqual({ estado: 'respondida', carga: CARGA });
    expect(segundo).toBeNull();
    expect(p.responder).toHaveBeenCalledTimes(1);
  });

  it('Review Focus 2: un 409 aplica la carga nueva, sincroniza y suelta el candado', async () => {
    const respondedor = crearRespondedorCarga();
    const nueva = { ...CARGA, estado: 'pendiente' as const, version: 2, respondida_en: null };
    const p = pasos([{ tipo: 'cambio', carga: nueva }]);
    await expect(respondedor.responder(p)).resolves.toEqual({ estado: 'cambio', mensaje: MENSAJE_CARGA_CAMBIO });
    expect(p.aplicar).toHaveBeenCalledWith(nueva);
    expect(p.sincronizar).toHaveBeenCalledTimes(1);
    // Revisa la nueva y vuelve a tocar: ahora si responde.
    const otra = pasos([{ tipo: 'ok', carga: { ...nueva, estado: 'aceptada' } }]);
    await expect(respondedor.responder(otra)).resolves.toMatchObject({ estado: 'respondida' });
  });

  it('Review Focus 4: un 404 sincroniza y avisa que se eliminó', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'inexistente' }]);
    await expect(respondedor.responder(p)).resolves.toEqual({
      estado: 'eliminada',
      mensaje: MENSAJE_CARGA_ELIMINADA,
    });
    expect(p.sincronizar).toHaveBeenCalledTimes(1);
    expect(p.aplicar).not.toHaveBeenCalled();
  });

  it('sin red: "Conéctate al WiFi para aceptar la carga." y se puede reintentar', async () => {
    const respondedor = crearRespondedorCarga();
    await expect(respondedor.responder(pasos([new Error('sin red')]))).resolves.toEqual({
      estado: 'sin-red',
      mensaje: MENSAJE_SIN_RED_CARGA,
    });
    expect(MENSAJE_SIN_RED_CARGA).toBe('Conéctate al WiFi para aceptar la carga.');
    await expect(respondedor.responder(pasos([{ tipo: 'ok', carga: CARGA }]))).resolves.toMatchObject({
      estado: 'respondida',
    });
  });

  it('401: sincroniza (que renueva por su camino normal) y reintenta UNA vez', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'sesion' }, { tipo: 'ok', carga: CARGA }]);
    await expect(respondedor.responder(p)).resolves.toMatchObject({ estado: 'respondida' });
    expect(p.sincronizar).toHaveBeenCalledTimes(1);
    expect(p.responder).toHaveBeenCalledTimes(2);

    const otro = crearRespondedorCarga();
    const sinSesion = pasos([{ tipo: 'sesion' }, { tipo: 'sesion' }]);
    await expect(otro.responder(sinSesion)).resolves.toEqual({
      estado: 'sin-sesion',
      mensaje: MENSAJE_SESION_CARGA,
    });
  });

  it('F4: si aplicar truena, el error sale y el candado se suelta (finally) para reintentar', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'ok', carga: CARGA }]);
    p.aplicar.mockImplementation(() => {
      throw new Error('la base local truena');
    });
    await expect(respondedor.responder(p)).rejects.toThrow('la base local truena');
    // El servidor es idempotente con la misma respuesta: reintentar es seguro.
    await expect(respondedor.responder(pasos([{ tipo: 'ok', carga: CARGA }]))).resolves.toMatchObject({
      estado: 'respondida',
    });
  });

  it('F4: tambien se suelta si truena aplicar la carga nueva de un 409', async () => {
    const respondedor = crearRespondedorCarga();
    const p = pasos([{ tipo: 'cambio', carga: { ...CARGA, version: 2 } }]);
    p.aplicar.mockImplementation(() => {
      throw new Error('la base local truena');
    });
    await expect(respondedor.responder(p)).rejects.toThrow('la base local truena');
    await expect(respondedor.responder(pasos([{ tipo: 'ok', carga: CARGA }]))).resolves.toMatchObject({
      estado: 'respondida',
    });
  });

  it('400: el mensaje del servidor', async () => {
    const respondedor = crearRespondedorCarga();
    await expect(
      respondedor.responder(pasos([{ tipo: 'invalida', mensaje: 'Aceptar una carga no lleva motivo.' }])),
    ).resolves.toEqual({ estado: 'invalida', mensaje: 'Aceptar una carga no lleva motivo.' });
  });
});

describe('filasPorRegresar (T-27 pieza 2)', () => {
  it('piezas buenas = la existencia (nunca negativa) y la merma; sin nada que regresar no sale', () => {
    expect(
      filasPorRegresar([
        { presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L', existencia: 23, mermaPorRegresar: 4 },
        { presentacionId: 'pre-2', etiqueta: 'Jamaica 500 ml', existencia: -1, mermaPorRegresar: 0 },
        { presentacionId: 'pre-3', etiqueta: 'Horchata 1 L', existencia: 0, mermaPorRegresar: 2 },
      ]),
    ).toEqual([
      { presentacionId: 'pre-1', etiqueta: 'Jamaica 1 L', buenas: 23, merma: 4 },
      { presentacionId: 'pre-3', etiqueta: 'Horchata 1 L', buenas: 0, merma: 2 },
    ]);
  });
});
