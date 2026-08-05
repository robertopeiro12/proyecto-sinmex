import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { SesionRepository } from './sesion.repository';
import { msDeSesionRefresh } from './ttl-sesion';

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

    // Baja logica del usuario: sin esto, quien ya tuviera sesion abierta
    // seguiria rotando para siempre (cada rotacion emite una sesion nueva de
    // 12 h, asi que la sesion nunca vence sola) y conservaria acceso a la API
    // aunque este dado de baja. /auth/me si filtra deleted_at, pero eso solo
    // salva a ese endpoint; la puerta de verdad es esta.
    //
    // Va DESPUES de la deteccion de reuso, no antes, y no revoca la cadena:
    //
    // - Despues, porque un token reusado es un token reusado independientemente
    //   del estado del usuario; anteponer este chequeo cambiaria el
    //   comportamiento de la rama de seguridad mas valiosa del sistema (un
    //   token robado de un usuario dado de baja dejaria de cortar la cadena).
    // - Sin revocar, porque una baja no es un robo: revocarTodasDelUsuario
    //   existe para castigar el reuso, y usarla aqui haria que una baja y un
    //   robo dejaran exactamente el mismo rastro en la base, borrando la unica
    //   evidencia forense que tenemos. Ademas no hace falta: el rechazo ya es
    //   total (toda rotacion futura vuelve a pasar por aqui), asi que revocar
    //   solo agregaria escrituras. Y es reversible: si la baja fue un error y
    //   se restaura al usuario, su sesion sigue sirviendo.
    if (sesion.usuario_deleted_at !== null) {
      throw new TokenInvalidoError('Usuario dado de baja.');
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

  /**
   * Cierre de sesion. Asimetria deliberada con rotarRefresh: aqui un token ya
   * revocado NO se trata como reuso, simplemente no hace nada.
   *
   * El motivo es que rotarRefresh CONCEDE algo (un par de tokens nuevos) y
   * logout no concede nada: ver un token revocado en una rotacion significa
   * que alguien intenta usar credenciales muertas para entrar, mientras que en
   * un logout significa, casi siempre, un doble clic en "Salir" o una pestana
   * vieja cerrandose. Castigar eso cortando la cadena entera sacaria al
   * usuario de sus otras sesiones legitimas a cambio de ninguna seguridad,
   * porque el logout ya dejo esa sesion muerta. No es un olvido.
   */
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
    return new Date(Date.now() + msDeSesionRefresh(this.config));
  }
}
