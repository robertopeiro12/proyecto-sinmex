import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { COOKIE_ACCESO } from './cookies';
import { ES_PUBLICO } from './publico.decorator';
import { TokenInvalidoError, TokenService } from './token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) {
      return true;
    }

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { usuarioId?: string }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[
      COOKIE_ACCESO
    ];
    if (!token) {
      throw new UnauthorizedException('Sin sesion.');
    }

    try {
      // verificarAcceso ya valida que 'tipo' sea 'usuario' (Tarea 5); no se
      // duplica ese chequeo aqui.
      const payload = this.tokens.verificarAcceso(token);
      req.usuarioId = payload.sub;
      return true;
    } catch (error) {
      if (error instanceof TokenInvalidoError) {
        throw new UnauthorizedException('Sesion invalida o vencida.');
      }
      throw error;
    }
  }
}
