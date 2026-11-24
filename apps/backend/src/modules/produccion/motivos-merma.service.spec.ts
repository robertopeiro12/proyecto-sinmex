import { BadRequestException, ConflictException } from '@nestjs/common';
import { MotivosMermaService } from './motivos-merma.service';
import type { MotivoMerma } from './motivos-merma.repository';

const M: MotivoMerma = {
  id: 'b6a1f3c2-0000-4000-8000-000000000001',
  nombre: 'Caducado',
  aplicaAlmacen: true,
  aplicaCliente: false,
  aplicaVehiculo: false,
  activo: true,
};

function montar() {
  const repo = {
    listarVivos: jest.fn().mockResolvedValue([M]),
    obtenerVivo: jest.fn().mockResolvedValue(M),
    crear: jest.fn().mockResolvedValue(M),
    editar: jest.fn().mockResolvedValue(M),
    darDeBaja: jest.fn().mockResolvedValue(true),
  };
  return { servicio: new MotivosMermaService(repo as never), repo };
}

describe('MotivosMermaService', () => {
  it('crear sin casillas las deja prendidas', async () => {
    const { servicio, repo } = montar();
    await servicio.crear({ nombre: 'X' });
    expect(repo.crear).toHaveBeenCalledWith('X', true, true, true);
  });

  it('crear con las tres apagadas es 400', async () => {
    const { servicio } = montar();
    await expect(
      servicio.crear({
        nombre: 'X',
        aplicaAlmacen: false,
        aplicaCliente: false,
        aplicaVehiculo: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('editar apagando la unica casilla viva es 400', async () => {
    const { servicio, repo } = montar();
    await expect(
      servicio.editar(M.id, { aplicaAlmacen: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.editar).not.toHaveBeenCalled();
  });

  it('nombre repetido es 409', async () => {
    const { servicio, repo } = montar();
    repo.crear.mockRejectedValue(
      Object.assign(new Error('d'), { code: '23505' }),
    );
    await expect(servicio.crear({ nombre: 'X' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('un filtro aplica desconocido es 400', () => {
    const { servicio } = montar();
    expect(() => servicio.listar('x')).toThrow(BadRequestException);
  });
});
