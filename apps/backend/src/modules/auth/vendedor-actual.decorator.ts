import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Inyecta el id del **vendedor** autenticado, que puso JwtAuthGuard en un
 * endpoint marcado con `@SoloApp()`.
 *
 * Lanza en vez de devolver un sentinela, por lo mismo que `@UsuarioActual`: un
 * id fantasma podria colar en una consulta o en logica de alcance en vez de
 * fallar ruidoso. Y son propiedades distintas de la peticion (`vendedorId` vs
 * `usuarioId`) a proposito: asi un endpoint del portal no puede leer por
 * descuido la identidad puesta por el otro camino.
 */
export const VendedorActual = createParamDecorator(
  (_datos: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { vendedorId?: string }>();
    if (!req.vendedorId) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return req.vendedorId;
  },
);
