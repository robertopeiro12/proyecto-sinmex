import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermisosGuard } from './permisos.guard';
import type { PermisosRepository } from './permisos.repository';
import { PERMISO_REQUERIDO } from './requiere-permiso.decorator';
import { ES_APP } from './solo-app.decorator';

/** Doble del Reflector: devuelve lo que se le ponga por clave de metadata. */
const reflectorCon = (valores: Record<string, unknown>): Reflector =>
  ({
    getAllAndOverride: (clave: string) => valores[clave],
  }) as unknown as Reflector;

const contextoCon = (req: object): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const repositorioCon = (permisos: string[]): PermisosRepository =>
  ({
    permisosDe: () => Promise.resolve(new Set(permisos)),
  }) as unknown as PermisosRepository;

describe('PermisosGuard', () => {
  it('deja pasar un endpoint sin @RequierePermiso', async () => {
    const guard = new PermisosGuard(reflectorCon({}), repositorioCon([]));
    await expect(
      guard.canActivate(contextoCon({ usuarioId: 'u1' })),
    ).resolves.toBe(true);
  });

  it('deja pasar a quien tiene el permiso', async () => {
    const guard = new PermisosGuard(
      reflectorCon({ [PERMISO_REQUERIDO]: 'sucursal.gestionar' }),
      repositorioCon(['sucursal.gestionar']),
    );
    await expect(
      guard.canActivate(contextoCon({ usuarioId: 'u1' })),
    ).resolves.toBe(true);
  });

  // 403 y no 401: el usuario SI esta identificado (D5). Con un 401 el portal
  // intentaria refrescar la sesion y acabaria mandando al login a alguien que
  // tiene sesion valida.
  it('responde 403 a quien no lo tiene', async () => {
    const guard = new PermisosGuard(
      reflectorCon({ [PERMISO_REQUERIDO]: 'sucursal.gestionar' }),
      repositorioCon(['venta.registrar']),
    );
    await expect(
      guard.canActivate(contextoCon({ usuarioId: 'u1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // D6: un vendedor no tiene perfil ni permisos, asi que esa combinacion solo
  // puede ser una equivocacion nuestra. Truena en vez de negar en silencio,
  // que dejaria un endpoint de la tablet colgado de un permiso inalcanzable.
  it('truena si el endpoint es @SoloApp()', async () => {
    const guard = new PermisosGuard(
      reflectorCon({
        [PERMISO_REQUERIDO]: 'sucursal.gestionar',
        [ES_APP]: true,
      }),
      repositorioCon([]),
    );
    await expect(
      guard.canActivate(contextoCon({ vendedorId: 'v1' })),
    ).rejects.toThrow(/SoloApp/);
  });

  it('truena si corre sin usuarioId (guards mal ordenados)', async () => {
    const guard = new PermisosGuard(
      reflectorCon({ [PERMISO_REQUERIDO]: 'sucursal.gestionar' }),
      repositorioCon(['sucursal.gestionar']),
    );
    await expect(guard.canActivate(contextoCon({}))).rejects.toThrow(
      /usuarioId/,
    );
  });
});
