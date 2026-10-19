import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MotivosVisitaService } from './motivos-visita.service';
import type { MotivoVisita } from './motivos-visita.repository';

const CERRADO: MotivoVisita = {
  id: 'b6a1f3c2-0000-4000-8000-000000000039',
  nombre: 'Cerrado',
  exigeFoto: true,
  exigeAtendio: false,
};

/** El `23505` tal como lo adjunta el driver `pg`. */
const unicidad = () => Object.assign(new Error('duplicado'), { code: '23505' });

function montar() {
  const repo = {
    listarVivos: jest.fn().mockResolvedValue([CERRADO]),
    crear: jest.fn().mockResolvedValue(CERRADO),
    editar: jest.fn().mockResolvedValue(CERRADO),
    darDeBaja: jest.fn().mockResolvedValue(true),
  };
  return { servicio: new MotivosVisitaService(repo as never), repo };
}

describe('MotivosVisitaService (T-39, D5)', () => {
  it('crear sin casillas las deja en false', async () => {
    const { servicio, repo } = montar();
    await servicio.crear({ nombre: 'Cerrado' });
    expect(repo.crear).toHaveBeenCalledWith('Cerrado', false, false);
  });

  it('un nombre repetido entre vivos es 409 con un mensaje que lo dice', async () => {
    const { servicio, repo } = montar();
    repo.crear.mockRejectedValue(unicidad());
    const error = await servicio
      .crear({ nombre: 'Cerrado' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(
      'Ya existe un motivo de visita llamado "Cerrado".',
    );
  });

  it('editar traduce los nombres de campo del portal a columnas', async () => {
    const { servicio, repo } = montar();
    await servicio.editar(CERRADO.id, { exigeAtendio: true });
    expect(repo.editar).toHaveBeenCalledWith(CERRADO.id, {
      exige_atendio: true,
    });
  });

  it('editar sin ningun campo es 400', async () => {
    const { servicio, repo } = montar();
    await expect(servicio.editar(CERRADO.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.editar).not.toHaveBeenCalled();
  });

  it('renombrar a uno que ya existe es 409', async () => {
    const { servicio, repo } = montar();
    repo.editar.mockRejectedValue(unicidad());
    await expect(
      servicio.editar(CERRADO.id, { nombre: 'Sin dinero' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('editar uno que no existe o ya esta dado de baja es 404', async () => {
    const { servicio, repo } = montar();
    repo.editar.mockResolvedValue(undefined);
    await expect(
      servicio.editar(CERRADO.id, { exigeFoto: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dar de baja uno que no existe es 404', async () => {
    const { servicio, repo } = montar();
    repo.darDeBaja.mockResolvedValue(false);
    await expect(servicio.darDeBaja(CERRADO.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
