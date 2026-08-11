import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PermisosRepository } from './permisos.repository';
import { PERMISO_REQUERIDO } from './requiere-permiso.decorator';
import { ES_APP } from './solo-app.decorator';

/**
 * Segundo guard global. Corre DESPUES de JwtAuthGuard porque depende del
 * `req.usuarioId` que aquel deja puesto — el orden lo fija la lista de
 * providers de app.module.ts.
 *
 * Reparto de casos:
 *
 * - endpoint sin `@RequierePermiso` -> pasa (sigue exigiendo solo sesion).
 * - tiene el permiso                -> pasa.
 * - no lo tiene                     -> 403 (D5: esta identificado, no le toca).
 * - `@SoloApp()` + `@RequierePermiso` -> error de programacion (D6).
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermisosRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requerido = this.reflector.getAllAndOverride<string | undefined>(
      PERMISO_REQUERIDO,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!requerido) {
      return true;
    }

    const esApp = this.reflector.getAllAndOverride<boolean | undefined>(
      ES_APP,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (esApp) {
      // Un vendedor no tiene perfil ni permisos: este permiso no se podria
      // cumplir NUNCA. Se rompe ruidosamente en vez de responder 403 para
      // siempre, que se veria como un bug de datos y no de codigo.
      throw new Error(
        `@RequierePermiso('${requerido}') sobre un endpoint @SoloApp(): los vendedores no tienen permisos.`,
      );
    }

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { usuarioId?: string }>();
    if (!req.usuarioId) {
      // Solo puede pasar si JwtAuthGuard no corrio antes (orden de providers
      // en app.module.ts) o si el endpoint es @Publico() y ademas exige
      // permiso, que es contradictorio.
      throw new Error(
        'PermisosGuard corrio sin usuarioId: revisa el orden de los guards en app.module.ts.',
      );
    }

    const efectivos = await this.permisos.permisosDe(req.usuarioId);
    if (!efectivos.has(requerido)) {
      throw new ForbiddenException('No tienes permiso para esta accion.');
    }
    return true;
  }
}
