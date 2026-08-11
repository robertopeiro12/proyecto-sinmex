import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hashearToken } from './hash-token';
import { SesionVendedorRepository } from './sesion-vendedor.repository';
import { TokenInvalidoError } from './token.service';
import { msDeAccesoApp, msDeSesionApp } from './ttl-sesion';

/**
 * Payload del JWT de la **app**.
 *
 * `tipo: 'vendedor'` es lo que separa este token del del portal. Los dos se
 * firman con el mismo `JWT_SECRET` —hay un solo backend— asi que sin este
 * campo un token de app serviria para entrar al portal y al reves. Es la misma
 * defensa que ya existia del otro lado (`PayloadAcceso.tipo === 'usuario'`),
 * ahora en ambos sentidos.
 */
export interface PayloadAccesoVendedor {
  sub: string;
  tipo: 'vendedor';
}

export interface TokensVendedor {
  acceso: string;
  accesoExpiraEn: Date;
  refresh: string;
  sesionExpiraEn: Date;
}

/**
 * Tokens de la app del vendedor.
 *
 * Es el gemelo de `TokenService` para el otro actor, y repite deliberadamente
 * su politica de rotacion (rota en cada uso; reusar un token ya revocado corta
 * TODA la cadena del vendedor, con el UPDATE condicional como punto de
 * serializacion). Los comentarios largos que explican **por que** cada decision
 * es como es viven en `token.service.ts` y no se copian aqui.
 *
 * Lo que si es distinto de la version del portal:
 *
 * - **Dos interruptores de baja**, no uno: `deleted_at` y `activo`. Ver
 *   `sesion-vendedor.repository.ts`.
 * - **TTL en horas**, no en el formato de la libreria `ms`, para poder calcular
 *   la fecha exacta de vencimiento: la app la necesita guardada para decidir
 *   sin red.
 */
@Injectable()
export class TokenVendedorService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sesiones: SesionVendedorRepository,
  ) {}

  emitirAcceso(vendedorId: string): { token: string; expiraEn: Date } {
    const ms = msDeAccesoApp(this.config);
    // `expiresIn` numerico = segundos (jsonwebtoken). Se usa el mismo numero
    // para el token y para la fecha que se le devuelve a la app, de forma que
    // no puedan separarse — la leccion de `ttl-sesion.ts`.
    const token = this.jwt.sign(
      { sub: vendedorId, tipo: 'vendedor' },
      { expiresIn: Math.floor(ms / 1000) },
    );
    return { token, expiraEn: new Date(Date.now() + ms) };
  }

  verificarAcceso(token: string): PayloadAccesoVendedor {
    let payload: PayloadAccesoVendedor;
    try {
      payload = this.jwt.verify<PayloadAccesoVendedor>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new TokenInvalidoError('Token de acceso invalido o vencido.');
    }

    if (payload.tipo !== 'vendedor') {
      throw new TokenInvalidoError('Tipo de token no valido para la app.');
    }

    return payload;
  }

  async emitirSesion(vendedorId: string): Promise<TokensVendedor> {
    const plano = randomBytes(32).toString('base64url');
    const sesionExpiraEn = this.calcularVencimiento();
    await this.sesiones.crear(vendedorId, hashearToken(plano), sesionExpiraEn);

    const acceso = this.emitirAcceso(vendedorId);
    return {
      acceso: acceso.token,
      accesoExpiraEn: acceso.expiraEn,
      refresh: plano,
      sesionExpiraEn,
    };
  }

  /**
   * Rota la sesion de la app. Ver `TokenService.rotarRefresh` para el detalle
   * de por que el orden de los chequeos es este y por que la baja no revoca la
   * cadena mientras que el reuso si.
   */
  async rotarSesion(
    tokenPlano: string,
  ): Promise<TokensVendedor & { vendedorId: string }> {
    const sesion = await this.sesiones.buscarPorHash(hashearToken(tokenPlano));

    if (!sesion) {
      throw new TokenInvalidoError('Sesion inexistente.');
    }

    if (sesion.revocada_en !== null) {
      await this.sesiones.revocarTodasDelVendedor(sesion.vendedor_id);
      throw new TokenInvalidoError(
        'Token de refresh reusado; sesiones revocadas.',
      );
    }

    // Los DOS interruptores. Un vendedor rotativo que sale de la empresa se
    // suele desactivar (`activo = false`), no borrar: comprobar solo
    // `deleted_at` dejaria exactamente el caso comun sin efecto, y esa tablet
    // seguiria renovando su sesion para siempre.
    if (sesion.vendedor_deleted_at !== null || !sesion.vendedor_activo) {
      throw new TokenInvalidoError('Vendedor dado de baja o inactivo.');
    }

    if (sesion.expira_en.getTime() <= Date.now()) {
      throw new TokenInvalidoError('Sesion vencida.');
    }

    const nuevoPlano = randomBytes(32).toString('base64url');
    const sesionExpiraEn = this.calcularVencimiento();
    const nuevoId = await this.sesiones.crear(
      sesion.vendedor_id,
      hashearToken(nuevoPlano),
      sesionExpiraEn,
    );

    const gano = await this.sesiones.revocarSiViva(sesion.id, nuevoId);
    if (!gano) {
      await this.sesiones.revocarTodasDelVendedor(sesion.vendedor_id);
      throw new TokenInvalidoError(
        'Token de refresh reusado; sesiones revocadas.',
      );
    }

    const acceso = this.emitirAcceso(sesion.vendedor_id);
    return {
      acceso: acceso.token,
      accesoExpiraEn: acceso.expiraEn,
      refresh: nuevoPlano,
      sesionExpiraEn,
      vendedorId: sesion.vendedor_id,
    };
  }

  /** Cierre de sesion. Un token ya revocado no se trata como reuso (ver el portal). */
  async revocarSesion(tokenPlano: string): Promise<void> {
    const sesion = await this.sesiones.buscarPorHash(hashearToken(tokenPlano));
    if (sesion && sesion.revocada_en === null) {
      await this.sesiones.revocar(sesion.id);
    }
  }

  private calcularVencimiento(): Date {
    return new Date(Date.now() + msDeSesionApp(this.config));
  }
}
