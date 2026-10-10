import { ConflictException } from '@nestjs/common';
import type { PasswordService } from '../auth/password.service';
import { MOTIVO_SEGMENTO_RESERVADO } from '../sincronizacion/segmento-vendedor';
import type { VendedoresRepository } from './vendedores.repository';
import { VendedoresService } from './vendedores.service';

function montar() {
  const repo = {
    buscarSucursalUsuario: jest
      .fn()
      .mockResolvedValue({ id: 'sucursal-tj', codigo: 'TJ' }),
    crear: jest.fn().mockResolvedValue({ id: 'vendedor-1' }),
  };
  const password = { hashear: jest.fn().mockResolvedValue('hash') };
  const servicio = new VendedoresService(
    repo as unknown as VendedoresRepository,
    password as unknown as PasswordService,
  );
  return { servicio, repo, password };
}

describe('VendedoresService.crear: el segmento OF es de la oficina (T-17)', () => {
  it('rechaza un nombre cuyas iniciales dan OF, sin hashear ni insertar', async () => {
    const { servicio, repo, password } = montar();

    const error: unknown = await servicio
      .crear('usuario-1', {
        nombre: 'Oscar Flores',
        login: 'oflores',
        contrasena: 'secreta',
      })
      .catch((e: unknown) => e);

    // Rechazar, no ceder (ADR-0007): asignarle OL en silencio cambiaria las
    // iniciales con que la oficina reconoce sus folios.
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      MOTIVO_SEGMENTO_RESERVADO,
    );
    expect(password.hashear).not.toHaveBeenCalled();
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('cualquier otro nombre sigue usando su primer candidato', async () => {
    const { servicio, repo } = montar();

    await servicio.crear('usuario-1', {
      nombre: 'Ana Perez',
      login: 'aperez',
      contrasena: 'secreta',
    });

    expect(repo.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        folioSegmento: 'AP',
        sucursalId: 'sucursal-tj',
      }),
    );
  });
});
