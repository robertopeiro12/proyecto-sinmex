import { NotFoundException } from '@nestjs/common';
import type { CobranzaTesoreriaRepository } from './cobranza-tesoreria.repository';
import type { MovimientosRepository } from './movimientos.repository';
import type { DestinosRepository } from './destinos.repository';
import type { CuentaEnAlcance } from './reglas-saldo';
import type { TesoreriaRepository } from './tesoreria.repository';
import { TesoreriaService } from './tesoreria.service';

const CUENTA = {
  id: 'c1',
  nombre: 'Efectivo',
  sucursalId: null,
  sucursalCodigo: null,
} as unknown as CuentaEnAlcance;

function armar(repo: Partial<Record<keyof TesoreriaRepository, jest.Mock>>) {
  const base = {
    buscarSucursalUsuario: jest
      .fn()
      .mockResolvedValue({ id: null, codigo: null }),
    buscarCuenta: jest.fn().mockResolvedValue(CUENTA),
    ...repo,
  };
  return new TesoreriaService(
    base as unknown as TesoreriaRepository,
    {
      listar: jest.fn().mockResolvedValue([]),
    } as unknown as DestinosRepository,
    {} as unknown as MovimientosRepository,
    {} as unknown as CobranzaTesoreriaRepository,
  );
}

describe('TesoreriaService: cuenta borrada en medio', () => {
  it('renombrar: si el repositorio ya no la encuentra, 404', async () => {
    const servicio = armar({
      renombrarCuenta: jest.fn().mockResolvedValue(undefined),
    });
    await expect(
      servicio.renombrarCuenta('u1', 'c1', { nombre: 'Nuevo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('crear: si el repositorio ya no la encuentra, 404', async () => {
    const servicio = armar({
      crearCuenta: jest.fn().mockResolvedValue(undefined),
    });
    await expect(
      servicio.crearCuenta('u1', { nombre: 'Nueva' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renombrar: con cuenta devuelve la cuenta', async () => {
    const servicio = armar({
      renombrarCuenta: jest.fn().mockResolvedValue(CUENTA),
    });
    await expect(
      servicio.renombrarCuenta('u1', 'c1', { nombre: 'Nuevo' }),
    ).resolves.toBe(CUENTA);
  });
});
