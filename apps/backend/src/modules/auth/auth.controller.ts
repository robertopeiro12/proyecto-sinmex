import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService, type UsuarioSesion } from './auth.service';
import { COOKIE_ACCESO, COOKIE_REFRESH, opcionesCookie } from './cookies';
import { msDeSesionRefresh } from './ttl-sesion';
import { LoginDto } from './dto/login.dto';
import { Publico } from './publico.decorator';
import { UsuarioActual } from './usuario-actual.decorator';
import { TokenInvalidoError, TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  @Publico()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const { acceso, refresh } = await this.auth.validarCredenciales(
      dto.login,
      dto.password,
    );
    this.ponerCookies(res, acceso, refresh);
    return { ok: true };
  }

  @Publico()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const actual = (req.cookies as Record<string, string> | undefined)?.[
      COOKIE_REFRESH
    ];
    if (!actual) {
      throw new UnauthorizedException('Sin sesion.');
    }

    try {
      const { acceso, refresh } = await this.tokens.rotarRefresh(actual);
      this.ponerCookies(res, acceso, refresh);
      return { ok: true };
    } catch (error) {
      if (error instanceof TokenInvalidoError) {
        this.limpiarCookies(res);
        throw new UnauthorizedException('Sesion invalida.');
      }
      throw error;
    }
  }

  // Publico a proposito: el guard global exigiria un access token vivo (15 min)
  // para llegar aqui, pero la sesion de refresh dura 12 horas. Sin esto, un
  // usuario que vuelve pasados los 15 min no podria cerrar sesion y el
  // refresh token seguiria vivo en la base con las cookies puestas. Es seguro
  // sin autenticacion: solo actua sobre el refresh token que venga en la
  // cookie, y revocarRefresh no hace nada si el token no existe o ya esta
  // revocado. El CSRF de logout queda mitigado por sameSite=lax sobre un POST.
  @Publico()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const actual = (req.cookies as Record<string, string> | undefined)?.[
      COOKIE_REFRESH
    ];
    if (actual) {
      await this.tokens.revocarRefresh(actual);
    }
    this.limpiarCookies(res);
    return { ok: true };
  }

  @Get('me')
  async me(@UsuarioActual() usuarioId: string): Promise<UsuarioSesion> {
    const usuario = await this.auth.buscarUsuarioPorId(usuarioId);
    if (!usuario) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return usuario;
  }

  /**
   * La cookie de acceso vive lo mismo que el refresh (12 h) a proposito:
   * quien manda es el expiresIn del JWT (15 min). Si la cookie muriera a
   * los 15 min, el navegador la borraria y el portal no tendria como
   * distinguir "hay que refrescar" de "no hay sesion".
   */
  private ponerCookies(res: Response, acceso: string, refresh: string): void {
    // El mismo maxAge que el expira_en de la fila en sesion_refresh: ambos
    // salen de msDeSesionRefresh() para que no puedan separarse (ver ttl-sesion.ts).
    const maxAge = msDeSesionRefresh(this.config);
    res.cookie(COOKIE_ACCESO, acceso, opcionesCookie(this.config, maxAge));
    res.cookie(COOKIE_REFRESH, refresh, opcionesCookie(this.config, maxAge));
  }

  private limpiarCookies(res: Response): void {
    res.clearCookie(COOKIE_ACCESO, opcionesCookie(this.config, 0));
    res.clearCookie(COOKIE_REFRESH, opcionesCookie(this.config, 0));
  }
}
