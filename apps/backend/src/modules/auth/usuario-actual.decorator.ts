import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Inyecta el id del usuario autenticado, que puso JwtAuthGuard.
 * Si falta o esta vacio, lanza en vez de devolver un sentinela: un id
 * fantasma ('') podria colar silenciosamente en una consulta contra una
 * columna text, o en logica de cacheo/scoping, en vez de fallar ruidoso.
 */
export const UsuarioActual = createParamDecorator(
  (_datos: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { usuarioId?: string }>();
    if (!req.usuarioId) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return req.usuarioId;
  },
);
