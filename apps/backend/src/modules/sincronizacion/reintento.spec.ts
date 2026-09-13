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

  describe('alReintentar', () => {
    it('avisa una vez por reintento, con el intento que fallo y el codigo de Postgres', async () => {
      const alReintentar = jest.fn();
      const tarea = jest
        .fn()
        .mockRejectedValueOnce(deadlock())
        .mockRejectedValueOnce(serializacion())
        .mockResolvedValue('aplicada');

      await expect(reintentarAnteConflicto(tarea, alReintentar)).resolves.toBe(
        'aplicada',
      );
      expect(alReintentar.mock.calls).toEqual([
        [1, '40P01'],
        [2, '40001'],
      ]);
    });

    it('no avisa si la tarea sale bien a la primera', async () => {
      const alReintentar = jest.fn();

      await reintentarAnteConflicto(
        jest.fn().mockResolvedValue('aplicada'),
        alReintentar,
      );
      expect(alReintentar).not.toHaveBeenCalled();
    });

    it('no avisa del ultimo intento: ese ya no se repite, sale el error', async () => {
      const alReintentar = jest.fn();
      const tarea = jest.fn().mockRejectedValue(deadlock());

      await expect(
        reintentarAnteConflicto(tarea, alReintentar),
      ).rejects.toMatchObject({ code: '40P01' });
      expect(alReintentar).toHaveBeenCalledTimes(INTENTOS_ANTE_CONFLICTO - 1);
    });

    it('no avisa de un error que no es de concurrencia', async () => {
      const alReintentar = jest.fn();
      const fk = Object.assign(new Error('fk'), { code: '23503' });

      await expect(
        reintentarAnteConflicto(jest.fn().mockRejectedValue(fk), alReintentar),
      ).rejects.toBe(fk);
      expect(alReintentar).not.toHaveBeenCalled();
    });
  });

  it('cualquier otro error sale en el primer intento, sin repetir', async () => {
    const fk = Object.assign(new Error('fk'), { code: '23503' });
    const tarea = jest.fn().mockRejectedValue(fk);

    await expect(reintentarAnteConflicto(tarea)).rejects.toBe(fk);
    expect(tarea).toHaveBeenCalledTimes(1);
  });
});
