import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { SesionRepository } from './sesion.repository';

/** Error de dominio; el controller lo traduce a 401. */
export class TokenInvalidoError extends Error {}

export interface PayloadAcceso {
  sub: string;
  tipo: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sesiones: SesionRepository,
  ) {}

  emitirAcceso(usuarioId: string): string {
    // El TTL viene de configuracion como string libre (p.ej. "15m"); jsonwebtoken
    // lo tipa contra un literal restringido de la libreria 'ms', de ahi el cast.
    const expiresIn = this.config.get<string>(
      'ACCESS_TOKEN_TTL',
      '15m',
    ) as JwtSignOptions['expiresIn'];
    return this.jwt.sign({ sub: usuarioId, tipo: 'usuario' }, { expiresIn });
  }

  verificarAcceso(token: string): PayloadAcceso {
    try {
      return this.jwt.verify<PayloadAcceso>(token);
    } catch {
      throw new TokenInvalidoError('Token de acceso invalido o vencido.');
    }
  }

  async emitirRefresh(usuarioId: string): Promise<string> {
    const plano = randomBytes(32).toString('base64url');
    await this.sesiones.crear(
      usuarioId,
      this.hashear(plano),
      this.calcularVencimiento(),
    );
    return plano;
  }

  /**
   * Rota el refresh: revoca el usado y emite uno nuevo encadenado.
   * Si el token ya estaba revocado, alguien lo esta reusando: se cortan
   * TODAS las sesiones del usuario, incluida la legitima.
   */
  async rotarRefresh(
    tokenPlano: string,
  ): Promise<{ acceso: string; refresh: string; usuarioId: string }> {
    const sesion = await this.sesiones.buscarPorHash(this.hashear(tokenPlano));

    if (!sesion) {
      throw new TokenInvalidoError('Sesion inexistente.');
    }

    if (sesion.revocada_en !== null) {
      await this.sesiones.revocarTodasDelUsuario(sesion.usuario_id);
      throw new TokenInvalidoError(
        'Token de refresh reusado; sesiones revocadas.',
      );
    }

    if (sesion.expira_en.getTime() <= Date.now()) {
      throw new TokenInvalidoError('Sesion vencida.');
    }

    const nuevoPlano = randomBytes(32).toString('base64url');
    const nuevoId = await this.sesiones.crear(
      sesion.usuario_id,
      this.hashear(nuevoPlano),
      this.calcularVencimiento(),
    );
    await this.sesiones.revocar(sesion.id, nuevoId);

    return {
      acceso: this.emitirAcceso(sesion.usuario_id),
      refresh: nuevoPlano,
      usuarioId: sesion.usuario_id,
    };
  }

  async revocarRefresh(tokenPlano: string): Promise<void> {
    const sesion = await this.sesiones.buscarPorHash(this.hashear(tokenPlano));
    if (sesion && sesion.revocada_en === null) {
      await this.sesiones.revocar(sesion.id);
    }
  }

  /**
   * SHA-256, no argon2: el token ya son 32 bytes aleatorios (no hay entropia
   * baja que proteger) y la busqueda por igualdad debe ser barata.
   */
  private hashear(plano: string): string {
    return createHash('sha256').update(plano).digest('hex');
  }

  private calcularVencimiento(): Date {
    const horas = Number(
      this.config.get<string>('REFRESH_TOKEN_TTL_HORAS', '12'),
    );
    return new Date(Date.now() + horas * 60 * 60 * 1000);
  }
}
