/**
 * Hash argon2id valido de una cadena arbitraria. AuthService la usa cuando el
 * login no existe, verificando contra ella igual que si existiera, para que
 * la respuesta tarde lo mismo en ambos casos (defensa contra enumeracion de
 * logins por tiempo de respuesta).
 *
 * Vive en su propio archivo (en vez de junto a AuthService) porque el e2e de
 * autenticacion necesita importarla para confirmar que sigue siendo un hash
 * argon2id que de verdad parsea; exportarla desde aqui es una constante de
 * dominio normal, no una concesion solo para pruebas.
 */
export const HASH_SENUELO =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsLXNlbnVlbG8tam9zZQ$rMSuJ2GH9m3GG4T5NqYUvJHDIZ2iBcCkzZBRQBRr6mY';
