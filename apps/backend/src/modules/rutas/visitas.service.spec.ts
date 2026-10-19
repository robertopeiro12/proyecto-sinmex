import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { VisitaNormalizada } from './datos-visita';
import { VisitaRechazada } from './visita-rechazada';
import { VisitasService, type ContextoVisita } from './visitas.service';

const trx = {} as Transaction<DB>;

const contexto: ContextoVisita = {
  id: 'c0ffee00-0000-4000-8000-000000000039',
  sucursalId: 'sucursal-tj',
  vendedorId: 'vendedor-1',
  clienteId: 'cliente-1',
  fechaOperacion: '2026-10-17',
};

const visita: VisitaNormalizada = {
  motivoVisitaId: 'motivo-cerrado',
  visitadaEn: '2026-10-17T18:40:00.000Z',
  observaciones: 'Cortina abajo',
  atendio: null,
  lat: null,
  lng: null,
  precisionM: null,
  direccionTexto: 'Frente al parque',
};

function montar(
  opciones: { motivoExiste?: boolean; idInsertado?: string | null } = {},
) {
  const repo = {
    motivoExiste: jest.fn().mockResolvedValue(opciones.motivoExiste ?? true),
    insertar: jest
      .fn()
      .mockResolvedValue(
        'idInsertado' in opciones ? opciones.idInsertado : contexto.id,
      ),
  };
  return { servicio: new VisitasService(repo), repo };
}

describe('VisitasService.registrarVisita (T-39, D3)', () => {
  it('inserta con el id de la clave, el dia del sobre y el alcance del token', async () => {
    const { servicio, repo } = montar();
    await expect(
      servicio.registrarVisita(visita, contexto, trx),
    ).resolves.toEqual({
      tabla: 'visita',
      id: contexto.id,
    });
    expect(repo.motivoExiste).toHaveBeenCalledWith('motivo-cerrado', trx);
    expect(repo.insertar).toHaveBeenCalledWith(
      {
        id: contexto.id,
        vendedorId: 'vendedor-1',
        sucursalId: 'sucursal-tj',
        clienteId: 'cliente-1',
        motivoVisitaId: 'motivo-cerrado',
        fecha: '2026-10-17',
        visitadaEn: '2026-10-17T18:40:00.000Z',
        observaciones: 'Cortina abajo',
        atendio: null,
        lat: null,
        lng: null,
        precisionM: null,
        direccionTexto: 'Frente al parque',
      },
      trx,
    );
  });

  it('un motivo que no existe es motivo-visita-inexistente y no inserta', async () => {
    const { servicio, repo } = montar({ motivoExiste: false });
    const error = await servicio
      .registrarVisita(visita, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VisitaRechazada);
    expect(error).toMatchObject({ razon: 'motivo-visita-inexistente' });
    expect(repo.insertar).not.toHaveBeenCalled();
  });

  it('un id ocupado es visita-id-ocupado con un motivo neutro', async () => {
    const { servicio } = montar({ idInsertado: null });
    const error = await servicio
      .registrarVisita(visita, contexto, trx)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ razon: 'visita-id-ocupado' });
    // Neutro: no dice de quien es ni que hay ahi (podria ser de otra sucursal).
    expect((error as Error).message).not.toMatch(/cliente|sucursal|vendedor/i);
  });
});
