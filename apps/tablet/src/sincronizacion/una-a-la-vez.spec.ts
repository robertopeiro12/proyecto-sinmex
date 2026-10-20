import { unaALaVez } from './una-a-la-vez';

/**
 * F1 (T-27): la sincronizacion del proveedor reusa la corrida en curso. Dos
 * corridas a la vez renovarian dos veces con el mismo refresh token, y el
 * servidor trata un refresh reutilizado como robo: revoca TODAS las sesiones
 * del vendedor. Con la respuesta a la carga (401 → sincronizar) el choque con
 * la sincronizacion del login o del boton se vuelve facil.
 */

function diferida<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

describe('unaALaVez', () => {
  it('dos llamadas mientras corre la primera comparten la misma corrida', async () => {
    const d = diferida<string>();
    const tarea = jest.fn(() => d.promesa);
    const correr = unaALaVez(tarea);

    const primera = correr();
    await Promise.resolve();
    const segunda = correr();
    expect(segunda).toBe(primera);

    d.resolver('listo');
    await expect(Promise.all([primera, segunda])).resolves.toEqual(['listo', 'listo']);
    expect(tarea).toHaveBeenCalledTimes(1);
  });

  it('cuando termina, la siguiente llamada corre de nuevo', async () => {
    let vuelta = 0;
    const tarea = jest.fn(async () => {
      vuelta += 1;
      return vuelta;
    });
    const correr = unaALaVez(tarea);
    await expect(correr()).resolves.toBe(1);
    await expect(correr()).resolves.toBe(2);
    expect(tarea).toHaveBeenCalledTimes(2);
  });

  it('si la corrida truena, el error llega a todos y la siguiente vuelve a correr', async () => {
    const d = diferida<string>();
    const tarea = jest.fn().mockReturnValueOnce(d.promesa).mockResolvedValueOnce('otra');
    const correr = unaALaVez(tarea as () => Promise<string>);

    const primera = correr();
    const segunda = correr();
    d.rechazar(new Error('se cayo'));
    await expect(primera).rejects.toThrow('se cayo');
    await expect(segunda).rejects.toThrow('se cayo');

    await expect(correr()).resolves.toBe('otra');
    expect(tarea).toHaveBeenCalledTimes(2);
  });
});

describe('unaALaVez con una tarea que lanza de forma sincrona', () => {
  it('rechaza y no se queda trabada', async () => {
    const tarea = jest
      .fn<Promise<string>, []>()
      .mockImplementationOnce(() => {
        throw new Error('sincrono');
      })
      .mockResolvedValueOnce('despues');
    const correr = unaALaVez(tarea);
    await expect(correr()).rejects.toThrow('sincrono');
    await expect(correr()).resolves.toBe('despues');
  });
});
