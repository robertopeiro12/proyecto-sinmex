import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CamposEgresoService } from './campos-egreso.service';
import type { CampoEgreso } from './campos-egreso.repository';

const HIELO: CampoEgreso = {
  id: 'b6a1f3c2-0000-4000-8000-000000000030',
  nombre: 'Hielo',
  tipo: 'operacion',
  seUsaEnApp: true,
};

/** El `23505` tal como lo adjunta el driver `pg`. */
const unicidad = () => Object.assign(new Error('duplicado'), { code: '23505' });

function montar() {
  const repo = {
    listarVivos: jest.fn().mockResolvedValue([HIELO]),
    crear: jest.fn().mockResolvedValue(HIELO),
    editar: jest.fn().mockResolvedValue(HIELO),
    tieneGastosDesde: jest.fn().mockResolvedValue(false),
    darDeBaja: jest.fn().mockResolvedValue(true),
  };
  return { servicio: new CamposEgresoService(repo as never), repo };
}

describe('CamposEgresoService (T-30, D2/D3)', () => {
  it('crear sin la casilla la deja en false', async () => {
    const { servicio, repo } = montar();
    await servicio.crear({ nombre: 'Hielo', tipo: 'operacion' });
    expect(repo.crear).toHaveBeenCalledWith('Hielo', 'operacion', false);
  });

  it('un nombre repetido entre vivos es 409 con un mensaje que lo dice', async () => {
    const { servicio, repo } = montar();
    repo.crear.mockRejectedValue(unicidad());
    const error = await servicio
      .crear({ nombre: 'Hielo', tipo: 'operacion' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(
      'Ya existe un campo de egreso llamado "Hielo".',
    );
  });

  it('editar traduce los nombres de campo del portal a columnas', async () => {
    const { servicio, repo } = montar();
    await servicio.editar(HIELO.id, { seUsaEnApp: false, tipo: 'produccion' });
    expect(repo.editar).toHaveBeenCalledWith(HIELO.id, {
      se_usa_en_app: false,
      tipo: 'produccion',
    });
  });

  it('editar sin ningun campo es 400', async () => {
    const { servicio, repo } = montar();
    await expect(servicio.editar(HIELO.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.editar).not.toHaveBeenCalled();
  });

  it('renombrar a uno que ya existe es 409', async () => {
    const { servicio, repo } = montar();
    repo.editar.mockRejectedValue(unicidad());
    await expect(
      servicio.editar(HIELO.id, { nombre: 'Gasolina' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('editar uno que no existe o ya esta dado de baja es 404', async () => {
    const { servicio, repo } = montar();
    repo.editar.mockResolvedValue(undefined);
    await expect(
      servicio.editar(HIELO.id, { seUsaEnApp: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la baja busca gastos desde el 1 de enero del año de Tijuana', async () => {
    const { servicio, repo } = montar();
    await servicio.darDeBaja(HIELO.id, new Date('2027-01-01T07:30:00Z'));
    expect(repo.tieneGastosDesde).toHaveBeenCalledWith(HIELO.id, '2026-01-01');
    expect(repo.darDeBaja).toHaveBeenCalledWith(HIELO.id);
  });

  it('con gastos vivos este año la baja es 409 y no da de baja nada', async () => {
    const { servicio, repo } = montar();
    repo.tieneGastosDesde.mockResolvedValue(true);
    const error = await servicio
      .darDeBaja(HIELO.id, new Date('2026-10-20T20:00:00Z'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(
      'Este campo tiene gastos este año; podrás darlo de baja el próximo año.',
    );
    expect(repo.darDeBaja).not.toHaveBeenCalled();
  });

  it('dar de baja uno que no existe es 404', async () => {
    const { servicio, repo } = montar();
    repo.darDeBaja.mockResolvedValue(false);
    await expect(servicio.darDeBaja(HIELO.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
