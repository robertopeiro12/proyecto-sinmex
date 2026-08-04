import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Hash argon2id valido de una cadena arbitraria. Se verifica contra el cuando
 * el login no existe, para que la respuesta tarde lo mismo en ambos casos.
 * Exportado unicamente para que el e2e (Tarea 8) pueda confirmar que sigue
 * siendo un hash argon2id que de verdad parsea; no se usa fuera de este
 * modulo en produccion.
 */
export const HASH_SENUELO =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsLXNlbnVlbG8tam9zZQ$rMSuJ2GH9m3GG4T5NqYUvJHDIZ2iBcCkzZBRQBRr6mY';

export interface UsuarioSesion {
  id: string;
  login: string;
  nombre: string;
  perfil: string;
  sucursal: { id: string; codigo: string; nombre: string } | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Un solo 401 para "no existe" y "contrasena incorrecta": distinguirlos
   * le confirmaria a un atacante que un login existe.
   */
  async validarCredenciales(
    login: string,
    password: string,
  ): Promise<{ acceso: string; refresh: string }> {
    const usuario = await this.db
      .selectFrom('usuario')
      .select(['id', 'password_hash'])
      .where('login', '=', login)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    // Se verifica siempre, incluso sin usuario, para no filtrar por tiempo de respuesta.
    const hash = usuario?.password_hash ?? HASH_SENUELO;
    const valida = await this.passwords.verificar(hash, password);

    if (!usuario || !valida) {
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    return {
      acceso: this.tokens.emitirAcceso(usuario.id),
      refresh: await this.tokens.emitirRefresh(usuario.id),
    };
  }

  async buscarUsuarioPorId(id: string): Promise<UsuarioSesion | undefined> {
    const fila = await this.db
      .selectFrom('usuario')
      .innerJoin('perfil', 'perfil.id', 'usuario.perfil_id')
      .leftJoin('sucursal', 'sucursal.id', 'usuario.sucursal_id')
      .select([
        'usuario.id as id',
        'usuario.login as login',
        'usuario.nombre as nombre',
        'perfil.nombre as perfil',
        'sucursal.id as sucursal_id',
        'sucursal.codigo as sucursal_codigo',
        'sucursal.nombre as sucursal_nombre',
      ])
      .where('usuario.id', '=', id)
      .where('usuario.deleted_at', 'is', null)
      .executeTakeFirst();

    if (!fila) {
      return undefined;
    }

    return {
      id: fila.id,
      login: fila.login,
      nombre: fila.nombre,
      perfil: fila.perfil,
      // La unica senal de "General" es sucursal_id IS NULL. Comprobar por
      // truthiness de codigo/nombre en vez de esto ensancharia el alcance en
      // silencio si alguno llegara en cadena vacia, aunque el usuario si
      // tenga una sucursal asignada.
      sucursal:
        fila.sucursal_id === null
          ? null
          : {
              id: fila.sucursal_id,
              codigo: fila.sucursal_codigo as string,
              nombre: fila.sucursal_nombre as string,
            },
    };
  }
}
