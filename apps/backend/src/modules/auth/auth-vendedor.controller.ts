import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthVendedorService,
  type RespuestaAuthApp,
  type VendedorSesion,
} from './auth-vendedor.service';
import { LoginAppDto, RefrescarAppDto } from './dto/login-app.dto';
import { Publico } from './publico.decorator';
import { SoloApp } from './solo-app.decorator';
import { TokenInvalidoError } from './token.service';
import { TokenVendedorService } from './token-vendedor.service';
import { VendedorActual } from './vendedor-actual.decorator';

/**
 * Autenticacion de la **app de tablet** ([[Vendedor]]).
 *
 * Vive bajo `/auth/app/*` y no mezclado con `/auth/*` para que la separacion
 * entre los dos actores se vea desde la URL: quien lea los logs o una regla de
 * firewall distingue de inmediato el trafico del portal del de las tablets.
 *
 * > [!important] Tokens en el cuerpo y en el encabezado, nunca cookies
 * > Ver el comentario de `JwtAuthGuard.autorizarApp` y el ADR-0005.
 */
@Controller('auth/app')
export class AuthVendedorController {
  constructor(
    private readonly auth: AuthVendedorService,
    private readonly tokens: TokenVendedorService,
  ) {}

  @Publico()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginAppDto): Promise<RespuestaAuthApp> {
    return this.auth.validarCredenciales(dto.login, dto.password);
  }

  /**
   * Rota la sesion. Es tambien lo que **corre hacia adelante la ventana
   * offline** de la tablet: cada refresh exitoso es un contacto con el
   * servidor, y la app reinicia su cuenta desde ahi.
   */
  @Publico()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefrescarAppDto): Promise<RespuestaAuthApp> {
    try {
      return await this.auth.refrescar(dto.tokenRefresh);
    } catch (error) {
      if (error instanceof TokenInvalidoError) {
        // 401 generico: la app lo interpreta como "esta sesion ya no vale" y
        // borra su material local. Es el unico camino por el que una baja
        // hecha en el portal llega a una tablet.
        throw new UnauthorizedException('Sesion invalida.');
      }
      throw error;
    }
  }

  /**
   * Publico a proposito, igual que el logout del portal: el access token dura
   * 12 h pero la sesion 7 dias, asi que exigir un token vivo dejaria el boton
   * de salir inservible justo cuando hace falta. Es seguro sin autenticacion:
   * solo actua sobre el refresh token que le manden, y revocar uno inexistente
   * o ya revocado no hace nada.
   */
  @Publico()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefrescarAppDto): Promise<{ ok: true }> {
    await this.tokens.revocarSesion(dto.tokenRefresh);
    return { ok: true };
  }

  /**
   * Quien soy. `@SoloApp()` hace que el guard exija un Bearer de vendedor: una
   * cookie del portal no entra aqui.
   */
  @SoloApp()
  @Get('me')
  async me(@VendedorActual() vendedorId: string): Promise<VendedorSesion> {
    const vendedor = await this.auth.buscarVendedorPorId(vendedorId);
    if (!vendedor) {
      throw new UnauthorizedException('Sesion invalida.');
    }
    return vendedor;
  }
}
