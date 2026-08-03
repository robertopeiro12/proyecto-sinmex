import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hashing de contrasenas con argon2id (recomendacion actual de OWASP).
 * Los parametros por defecto de @node-rs/argon2 ya son los recomendados.
 */
@Injectable()
export class PasswordService {
  hashear(plano: string): Promise<string> {
    return hash(plano);
  }

  async verificar(hashGuardado: string, plano: string): Promise<boolean> {
    try {
      return await verify(hashGuardado, plano);
    } catch {
      // Hash corrupto o con formato desconocido: no es una verificacion valida.
      return false;
    }
  }
}
