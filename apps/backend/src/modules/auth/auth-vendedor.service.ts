import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { HASH_SENUELO } from './auth.constantes';
import { PasswordService } from './password.service';
import { TokenVendedorService } from './token-vendedor.service';
import { horasDeVentanaOffline, iteracionesVerificador } from './ttl-sesion';

/** Lo que la app necesita saber del vendedor y guardar para operar sin red. */
export interface VendedorSesion {
  id: string;
  login: string;
  nombre: string;
  sucursal: { id: string; codigo: string; nombre: string };
}

/**
 * Reglas que la app obedece y el servidor decide.
 *
 * Van en la respuesta del login (en vez de estar compiladas en el APK) porque
 * son las dos cosas que habra que ajustar con tablets en la calle: cuanto
 * tiempo se confia en un dispositivo incomunicado, y cuanto coste aguanta su
 * CPU. Cambiarlas debe ser editar un `.env`, no publicar una version.
 */
export interface PoliticaSesionApp {
  ventanaOfflineHoras: number;
  costeVerificador: number;
}

export interface RespuestaAuthApp {
  vendedor: VendedorSesion;
  tokenAcceso: string;
  accesoExpiraEn: string;
  tokenRefresh: string;
  sesionExpiraEn: string;
  politica: PoliticaSesionApp;
}

/**
 * Autenticacion del **[[Vendedor]]** (app de tablet), distinta de la del
 * [[Usuario]] del portal.
 *
 * Son entidades separadas en el modelo (T-05) y aqui se mantienen separadas: no
 * comparten tabla, ni sesion, ni tipo de token. Lo que si se reutiliza es todo
 * lo que ya estaba resuelto y probado — `PasswordService` (argon2id), el hash
 * senuelo contra enumeracion por tiempo, y la politica de rotacion de refresh.
 *
 * > [!important] El servidor no entrega material para verificar offline
 * > La respuesta no lleva el hash argon2id ni ningun derivado de la contrasena.
 * > El verificador local lo produce la app con la contrasena que el vendedor
 * > acaba de teclear (ver `apps/tablet/src/seguridad/verificador.ts` y el
 * > ADR-0005). Mandar el hash del servidor lo pondria en la red y en el
 * > dispositivo sin ganar nada.
 */
@Injectable()
export class AuthVendedorService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenVendedorService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Un solo 401 para "no existe", "esta inactivo" y "contrasena incorrecta".
   * Distinguirlos le confirmaria a un atacante que un login existe — el mismo
   * criterio que en el portal.
   */
  async validarCredenciales(
    login: string,
    password: string,
  ): Promise<RespuestaAuthApp> {
    const vendedor = await this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.login as login',
        'vendedor.nombre as nombre',
        'vendedor.password_hash as password_hash',
        'vendedor.activo as activo',
        'sucursal.id as sucursal_id',
        'sucursal.codigo as sucursal_codigo',
        'sucursal.nombre as sucursal_nombre',
      ])
      .where('vendedor.login', '=', login)
      .where('vendedor.deleted_at', 'is', null)
      .executeTakeFirst();

    // Se verifica siempre, incluso sin vendedor, para no filtrar por tiempo de
    // respuesta. Se hace ANTES de mirar `activo` por la misma razon: cortar
    // temprano para un vendedor inactivo devolveria el 401 sin pagar el coste
    // de argon2, y esa diferencia de tiempo delata que el login existe.
    const hash = vendedor?.password_hash ?? HASH_SENUELO;
    const valida = await this.passwords.verificar(hash, password);

    if (!vendedor || !valida || !vendedor.activo) {
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    const tokens = await this.tokens.emitirSesion(vendedor.id);

    return this.armarRespuesta(
      {
        id: vendedor.id,
        login: vendedor.login,
        nombre: vendedor.nombre,
        sucursal: {
          id: vendedor.sucursal_id,
          codigo: vendedor.sucursal_codigo,
          nombre: vendedor.sucursal_nombre,
        },
      },
      tokens,
    );
  }

  /** Datos del vendedor de una sesion viva. Usado por `/auth/app/me` y por el refresh. */
  async buscarVendedorPorId(id: string): Promise<VendedorSesion | undefined> {
    const fila = await this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select([
        'vendedor.id as id',
        'vendedor.login as login',
        'vendedor.nombre as nombre',
        'sucursal.id as sucursal_id',
        'sucursal.codigo as sucursal_codigo',
        'sucursal.nombre as sucursal_nombre',
      ])
      .where('vendedor.id', '=', id)
      .where('vendedor.deleted_at', 'is', null)
      .where('vendedor.activo', '=', true)
      .executeTakeFirst();

    if (!fila) return undefined;

    return {
      id: fila.id,
      login: fila.login,
      nombre: fila.nombre,
      sucursal: {
        id: fila.sucursal_id,
        codigo: fila.sucursal_codigo,
        nombre: fila.sucursal_nombre,
      },
    };
  }

  /** Rota la sesion y devuelve la misma forma que el login. */
  async refrescar(tokenRefresh: string): Promise<RespuestaAuthApp> {
    const tokens = await this.tokens.rotarSesion(tokenRefresh);
    const vendedor = await this.buscarVendedorPorId(tokens.vendedorId);
    if (!vendedor) {
      // rotarSesion ya rechaza vendedores de baja o inactivos; llegar aqui
      // significaria una carrera con una baja simultanea. Se trata igual.
      throw new UnauthorizedException('Sesion invalida.');
    }
    return this.armarRespuesta(vendedor, tokens);
  }

  private armarRespuesta(
    vendedor: VendedorSesion,
    tokens: {
      acceso: string;
      accesoExpiraEn: Date;
      refresh: string;
      sesionExpiraEn: Date;
    },
  ): RespuestaAuthApp {
    return {
      vendedor,
      tokenAcceso: tokens.acceso,
      accesoExpiraEn: tokens.accesoExpiraEn.toISOString(),
      tokenRefresh: tokens.refresh,
      sesionExpiraEn: tokens.sesionExpiraEn.toISOString(),
      politica: {
        ventanaOfflineHoras: horasDeVentanaOffline(this.config),
        costeVerificador: iteracionesVerificador(this.config),
      },
    };
  }
}
