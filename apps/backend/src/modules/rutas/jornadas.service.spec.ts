import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { JornadaNormalizada } from './datos-jornada';
import { JornadaRechazada } from './jornada-rechazada';
import { JornadasService, type ContextoJornada } from './jornadas.service';

const VEHICULO = '106c93f1-0c9a-4efc-b167-8c73eea9b023';

/** El servicio no usa la transaccion: solo la pasa a quien escribe. */
const trx = {} as Transaction<DB>;

const contexto: ContextoJornada = {
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  fechaOperacion: '2026-10-10',
};

const jornada: JornadaNormalizada = {
  vehiculoId: VEHICULO,
  kmInicial: 128450,
  kmFinal: 128512,
  abiertaEn: '2026-10-10T15:03:53.458Z',
  cerradaEn: '2026-10-11T01:19:55.706Z',
};

function montar(
  opciones: { vehiculoValido?: boolean; idInsertado?: string | null } = {},
) {
  const repo = {
    vehiculoDeLaSucursal: jest
      .fn()
      .mockResolvedValue(opciones.vehiculoValido ?? true),
    insertar: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : 'jornada-1',
      ),
  };
  return { servicio: new JornadasService(repo), repo };
}

describe('JornadasService.cerrarJornada (T-38)', () => {
  it('inserta con el dia, el vendedor y la sucursal del contexto y devuelve la fila para el buzon', async () => {
    const { servicio, repo } = montar();

    await expect(
      servicio.cerrarJornada(jornada, contexto, trx),
    ).resolves.toEqual({ tabla: 'jornada', id: 'jornada-1' });

    expect(repo.vehiculoDeLaSucursal).toHaveBeenCalledWith(
      VEHICULO,
      'sucursal-tj',
      trx,
    );
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        vendedorId: 'vendedor-1',
        vehiculoId: VEHICULO,
        sucursalId: 'sucursal-tj',
        fecha: '2026-10-10',
        kmInicial: 128450,
        kmFinal: 128512,
        abiertaEn: '2026-10-10T15:03:53.458Z',
        cerradaEn: '2026-10-11T01:19:55.706Z',
      },
      trx,
    );
  });

  it('un vehiculo que no es de la sucursal es vehiculo-inexistente y no inserta nada', async () => {
    const { servicio, repo } = montar({ vehiculoValido: false });

    const error = await servicio
      .cerrarJornada(jornada, contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JornadaRechazada);
    expect(error).toMatchObject({ razon: 'vehiculo-inexistente' });
    expect(repo.insertar).not.toHaveBeenCalled();
  });

  it('si ya habia una jornada viva ese dia es jornada-duplicada', async () => {
    const { servicio } = montar({ idInsertado: null });

    const error = await servicio
      .cerrarJornada(jornada, contexto, trx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JornadaRechazada);
    expect(error).toMatchObject({ razon: 'jornada-duplicada' });
    expect((error as Error).message).toContain('2026-10-10');
  });
});
