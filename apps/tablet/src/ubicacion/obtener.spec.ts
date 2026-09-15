import * as Location from 'expo-location';

import { obtenerUbicacion, TIEMPO_MAX_MS } from './obtener';

/**
 * `expo-location` es un modulo nativo: no existe fuera de React Native, asi que
 * se sustituye. Lo que se prueba aqui es **la decision**, que es lo unico que
 * esta capa aporta: que un permiso negado y un GPS sin senal se distingan, y que
 * ninguno de los dos lance — porque lo que no puede pasar es que impidan
 * registrar al prospecto.
 *
 * `jest.mock` va despues de los `import` aunque parezca al reves: el
 * transformador lo **iza** por encima de ellos, asi que el modulo sustituido ya
 * esta puesto cuando se resuelve el import. Ponerlo antes solo molesta al
 * `import/first` del linter.
 */
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3, Highest: 5 },
}));

const pedirPermiso = Location.requestForegroundPermissionsAsync as jest.Mock;
const leerPosicion = Location.getCurrentPositionAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('obtenerUbicacion', () => {
  it('devuelve las coordenadas cuando hay permiso y lectura', async () => {
    pedirPermiso.mockResolvedValue({ granted: true });
    leerPosicion.mockResolvedValue({
      coords: { latitude: 32.5149, longitude: -117.0382 },
    });

    await expect(obtenerUbicacion()).resolves.toEqual({
      estado: 'ok',
      lat: 32.5149,
      lng: -117.0382,
    });
  });

  it('pide SOLO el permiso de primer plano', async () => {
    // El de segundo plano es el rastreo continuo de T-41, que necesita su propio
    // ADR de mapas. Pedirlo aqui lo adelantaria sin que nadie lo haya decidido.
    pedirPermiso.mockResolvedValue({ granted: true });
    leerPosicion.mockResolvedValue({ coords: { latitude: 0, longitude: 0 } });

    await obtenerUbicacion();

    expect(pedirPermiso).toHaveBeenCalledTimes(1);
    expect(
      (Location as unknown as Record<string, unknown>)
        .requestBackgroundPermissionsAsync,
    ).toBeUndefined();
  });

  it('permiso negado: lo reporta y NO lee la posicion', async () => {
    pedirPermiso.mockResolvedValue({ granted: false });

    await expect(obtenerUbicacion()).resolves.toEqual({ estado: 'permiso-negado' });
    expect(leerPosicion).not.toHaveBeenCalled();
  });

  it('sin senal: lo distingue del permiso negado, porque reintentar puede servir', async () => {
    pedirPermiso.mockResolvedValue({ granted: true });
    leerPosicion.mockRejectedValue(new Error('Location provider is unavailable'));

    const r = await obtenerUbicacion();
    expect(r.estado).toBe('sin-senal');
    expect(r).toMatchObject({ detalle: expect.stringContaining('unavailable') });
  });

  it('un fallo al pedir el permiso tampoco lanza', async () => {
    pedirPermiso.mockRejectedValue(new Error('servicios de ubicacion apagados'));

    await expect(obtenerUbicacion()).resolves.toMatchObject({ estado: 'sin-senal' });
  });

  /**
   * `getCurrentPositionAsync` puede no volver NUNCA dentro de un local cerrado.
   * Un boton girando para siempre es peor que uno que dice "no pude": el vendedor
   * se queda mirando la pantalla sin saber si esperar.
   */
  it('se rinde tras el tiempo maximo en vez de esperar para siempre', async () => {
    jest.useFakeTimers();
    pedirPermiso.mockResolvedValue({ granted: true });
    leerPosicion.mockReturnValue(new Promise(() => {}));

    const promesa = obtenerUbicacion();
    // Se deja correr el `await` del permiso antes de mover el reloj.
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(TIEMPO_MAX_MS + 1);

    const r = await promesa;
    expect(r.estado).toBe('sin-senal');
    expect(r).toMatchObject({ detalle: expect.stringContaining('10 s') });
  });
});
