import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { SesionRepository } from './sesion.repository';

/** Error de dominio; el controller lo traduce a 401. */
export class TokenInvalidoError extends Error {}

export interface PayloadAcceso {
  sub: string;
  tipo: 'usuario';
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
    let payload: PayloadAcceso;
    try {
      // Se restringe el algoritmo aceptado: defensa en profundidad ante un
      // token firmado con un algoritmo distinto al que este servicio usa.
      payload = this.jwt.verify<PayloadAcceso>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new TokenInvalidoError('Token de acceso invalido o vencido.');
    }

    // El campo 'tipo' distingue actores (portal vs. futura app de tablet).
    // Un JWT firmado con el mismo secreto pero tipo distinto (p.ej.
    // 'vendedor') no debe ser aceptado en el portal.
    if (payload.tipo !== 'usuario') {
      throw new TokenInvalidoError('Tipo de token no valido para el portal.');
    }

    return payload;
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

    // Punto de serializacion: el UPDATE condicional (WHERE revocada_en IS
    // NULL) es lo unico que decide quien gana entre dos rotaciones
    // concurrentes del mismo token. Se crea la sesion nueva ANTES de
    // intentar revocar la vieja (y no al reves) porque asi, si esta llamada
    // pierde la carrera, ya existe una sesion nueva que revocarTodasDelUsuario
    // puede alcanzar y matar junto con todo lo demas; si revocaramos primero
    // no tendriamos con que encadenar la fila vieja al ganador.
    const gano = await this.sesiones.revocarSiViva(sesion.id, nuevoId);
    if (!gano) {
      // Otra rotacion concurrente ya revoco esta misma sesion entre nuestro
      // SELECT y este UPDATE: dos usos paralelos del mismo refresh token es
      // exactamente el escenario de reuso que se detecta mas arriba, asi
      // que se trata igual — se corta toda la cadena del usuario, incluida
      // la sesion nueva que esta llamada perdedora acaba de crear (sigue
      // viva, por lo que revocarTodasDelUsuario la alcanza).
      await this.sesiones.revocarTodasDelUsuario(sesion.usuario_id);
      throw new TokenInvalidoError(
        'Token de refresh reusado; sesiones revocadas.',
      );
    }

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
