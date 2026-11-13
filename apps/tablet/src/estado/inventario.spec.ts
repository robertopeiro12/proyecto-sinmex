import { existencias as existenciasDatos } from '@/datos/inventario-reglas';
import type { ResultadoApiCarga } from '@/sincronizacion/api-carga';
import type { CargaPull } from '@/sincronizacion/contrato';

import {
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
  textoTeQuedan,
  totalPiezas,
  validarRespuesta,
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
  lineas: [{ presentacion_id: 'pre-1', piezas: 24 }],
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

describe('la respuesta del vendedor (D2)', () => {
  it('aceptar no pide nada; rechazar pide motivo de hasta 300', () => {
    expect(validarRespuesta('aceptar', '')).toEqual([]);
    expect(validarRespuesta('rechazar', '   ')).toEqual(['Escribe por qué rechazas la carga.']);
    expect(validarRespuesta('rechazar', 'x'.repeat(301))).toEqual(['El motivo lleva hasta 300 caracteres.']);
    expect(validarRespuesta('rechazar', 'Faltan 2 cajas')).toEqual([]);
  });

  it('el cuerpo lleva la version que se VE y el motivo recortado solo al rechazar', () => {
    expect(cuerpoRespuesta('aceptar', 'lo que sea', 3)).toEqual({ version: 3, accion: 'aceptar' });
    expect(cuerpoRespuesta('rechazar', '  Faltan 2 cajas  ', 3)).toEqual({
      version: 3,
      accion: 'rechazar',
      motivo: 'Faltan 2 cajas',
    });
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
    expect(pastillaCarga('pendiente')).toEqual({ texto: 'Por aceptar', estado: 'pendiente' });
    expect(pastillaCarga('aceptada')).toEqual({ texto: 'Aceptada', estado: 'listo' });
    expect(pastillaCarga('rechazada')).toEqual({ texto: 'Rechazada', estado: 'error' });
    expect(totalPiezas([{ piezas: 24 }, { piezas: 12 }])).toBe(36);
  });

  it('"Te quedan N" descuenta lo capturado en esta venta; si no alcanza, dice cuanto falta', () => {
    expect(textoTeQuedan(20, 0)).toEqual({ texto: 'Te quedan 20', falta: false });
    expect(textoTeQuedan(20, 20)).toEqual({ texto: 'Te quedan 0', falta: false });
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
