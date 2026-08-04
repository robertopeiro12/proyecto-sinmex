import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Inyecta el id del usuario autenticado, que puso JwtAuthGuard. */
export const UsuarioActual = createParamDecorator(
  (_datos: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { usuarioId?: string }>();
    return req.usuarioId ?? '';
  },
);
