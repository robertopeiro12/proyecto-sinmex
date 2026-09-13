import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Los tres campos son opcionales: el servicio rechaza con 400 el cuerpo que
 * no traiga ninguno.
 *
 * SIN `sucursalId` (D3): la sucursal de un vendedor no se cambia -- su
 * segmento de folio quedo pinado para esa sucursal (D6).
 * SIN `login`: no se pidio poder editarlo; si hiciera falta, llevaria el
 * mismo `@Transform` de normalizarLogin que CrearVendedorDto.
 */
export class EditarVendedorDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre?: string;

  // D5: sin minimo de longitud. Vacio u omitido = no cambiar -- el portal
  // (Task 6) omite la clave del JSON cuando el campo quedo vacio.
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'La contraseña no puede quedar vacía.' })
  @MaxLength(200, {
    message: 'La contraseña no puede pasar de 200 caracteres.',
  })
  contrasena?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
