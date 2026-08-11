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
import { ES_APP } from './solo-app.decorator';
import { TokenInvalidoError, TokenService } from './token.service';
import { TokenVendedorService } from './token-vendedor.service';

/**
 * Guard global. Todo endpoint nace protegido; ademas, cada endpoint pertenece
 * a **un solo actor**:
 *
 * - por defecto → [[Usuario]] del portal: cookie httpOnly + JWT `tipo:'usuario'`.
 * - `@SoloApp()` → [[Vendedor]] de la app: `Authorization: Bearer` + JWT
 *   `tipo:'vendedor'`.
 * - `@Publico()` → sin sesion.
 *
 * Los dos caminos son excluyentes y ninguno cae en el otro: el portal no mira
 * el header y la app no mira la cookie. Que ademas los dos tipos de JWT se
 * distingan por su claim `tipo` es una segunda barrera, no la unica — importa
 * porque ambos se firman con el mismo `JWT_SECRET`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly tokensVendedor: TokenVendedorService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) {
      return true;
    }

    const esApp = this.reflector.getAllAndOverride<boolean>(ES_APP, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { usuarioId?: string; vendedorId?: string }>();

    return esApp ? this.autorizarApp(req) : this.autorizarPortal(req);
  }

  /** Portal: la sesion viaja en cookie httpOnly. Sin cambios respecto a T-06 (portal). */
  private autorizarPortal(req: Request & { usuarioId?: string }): boolean {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      COOKIE_ACCESO
    ];
    if (!token) {
      throw new UnauthorizedException('Sin sesion.');
    }

    try {
      // verificarAcceso ya valida que 'tipo' sea 'usuario'; no se duplica aqui.
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

  /**
   * App: la sesion viaja en el encabezado.
   *
   * Nada de cookies aqui. Una app nativa no tiene origen ni dominio, asi que
   * una cookie no la protegeria de nada y en cambio obligaria a un almacen de
   * cookies persistente fuera del control de la app — mientras que el token en
   * el header lo guarda ella en `expo-secure-store`, cifrado por el sistema.
   */
  private autorizarApp(req: Request & { vendedorId?: string }): boolean {
    const encabezado = req.headers.authorization;
    // `Bearer ` exacto y sensible a mayusculas en el esquema seria fragil; se
    // compara el esquema sin distinguir mayusculas, como manda RFC 7235.
    const token = encabezado?.match(/^Bearer (.+)$/i)?.[1]?.trim();
    if (!token) {
      throw new UnauthorizedException('Sin sesion.');
    }

    try {
      const payload = this.tokensVendedor.verificarAcceso(token);
      req.vendedorId = payload.sub;
      return true;
    } catch (error) {
      if (error instanceof TokenInvalidoError) {
        throw new UnauthorizedException('Sesion invalida o vencida.');
      }
      throw error;
    }
  }
}
