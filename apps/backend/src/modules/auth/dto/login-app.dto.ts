import { IsString, MinLength } from 'class-validator';

/** Login del [[Vendedor]] desde la app. Mismo contrato que el del portal. */
export class LoginAppDto {
  @IsString()
  @MinLength(1, { message: 'El login es obligatorio.' })
  login!: string;

  @IsString()
  @MinLength(1, { message: 'La contrasena es obligatoria.' })
  password!: string;
}

/**
 * El refresh de la app manda el token en el CUERPO, no en una cookie.
 *
 * Podria ir en el header, pero un `Authorization: Bearer` con un token opaco
 * de refresh se confundiria con el JWT de acceso en logs y proxies. En el
 * cuerpo queda claro cual es cual.
 */
export class RefrescarAppDto {
  @IsString()
  @MinLength(1, { message: 'El token de refresh es obligatorio.' })
  tokenRefresh!: string;
}
