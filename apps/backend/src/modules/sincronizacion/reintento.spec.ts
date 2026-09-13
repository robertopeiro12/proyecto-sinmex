import { INTENTOS_ANTE_CONFLICTO, reintentarAnteConflicto } from './reintento';

const deadlock = () =>
  Object.assign(new Error('deadlock detected'), { code: '40P01' });
const serializacion = () =>
  Object.assign(new Error('could not serialize access'), { code: '40001' });

describe('reintentarAnteConflicto', () => {
  it('son 3 intentos en total', () => {
    expect(INTENTOS_ANTE_CONFLICTO).toBe(3);
  });

  it('si la tarea sale bien a la primera, no la repite', async () => {
    const tarea = jest.fn().mockResolvedValue('aplicada');

    await expect(reintentarAnteConflicto(tarea)).resolves.toBe('aplicada');
    expect(tarea).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['40P01 (deadlock)', deadlock],
    ['40001 (serializacion)', serializacion],
  ])(
    'ante un %s repite la tarea y devuelve lo del segundo intento',
    async (_nombre, error) => {
      const tarea = jest
        .fn()
        .mockRejectedValueOnce(error())
        .mockResolvedValue('aplicada');

      await expect(reintentarAnteConflicto(tarea)).resolves.toBe('aplicada');
      expect(tarea).toHaveBeenCalledTimes(2);
    },
  );

  it('el tercer intento todavia cuenta', async () => {
    const tarea = jest
      .fn()
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValue('duplicada');

    await expect(reintentarAnteConflicto(tarea)).resolves.toBe('duplicada');
    expect(tarea).toHaveBeenCalledTimes(3);
  });

  it('si los tres intentos chocan, propaga el error del ultimo', async () => {
    const ultimo = deadlock();
    const tarea = jest
      .fn()
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(ultimo)
      .mockResolvedValue('nunca');

    await expect(reintentarAnteConflicto(tarea)).rejects.toBe(ultimo);
    expect(tarea).toHaveBeenCalledTimes(3);
  });

  it('cualquier otro error sale en el primer intento, sin repetir', async () => {
    const fk = Object.assign(new Error('fk'), { code: '23503' });
    const tarea = jest.fn().mockRejectedValue(fk);

    await expect(reintentarAnteConflicto(tarea)).rejects.toBe(fk);
    expect(tarea).toHaveBeenCalledTimes(1);
  });
});
