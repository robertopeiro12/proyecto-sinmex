import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Mismos campos que CrearUsuarioDto, con dos diferencias (D2, D8 del spec):
 * `contrasena` es OPCIONAL -- ausente o `undefined` significa "no cambiar".
 * El cliente (lib/usuarios.ts, Task 8) omite la clave del JSON cuando el
 * campo del formulario quedo vacio; NO manda una cadena vacia, que si
 * pasaria @MinLength(8) y volveria 400 sin que el usuario entienda por que.
 * `sucursalId` SI sigue presente y editable (a diferencia de
 * EditarClienteDto de T-12): la sucursal de un Usuario no es inmutable
 * (D8).
 */
export class EditarUsuarioDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El login es obligatorio.' })
  @MaxLength(60, { message: 'El login no puede pasar de 60 caracteres.' })
  login!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre!: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(200, {
    message: 'La contraseña no puede pasar de 200 caracteres.',
  })
  contrasena?: string;

  @IsUUID()
  perfilId!: string;

  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permisosMarcados!: string[];
}
