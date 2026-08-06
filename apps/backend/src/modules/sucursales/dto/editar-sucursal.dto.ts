import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `codigo` NO esta aqui, y esa ausencia es la que aplica D5: con
 * `whitelist: true` en el ValidationPipe global, cualquier `codigo` que venga
 * en el cuerpo se descarta antes de llegar al servicio. No hace falta un
 * chequeo explicito — hace falta NO agregar el campo.
 */
export class EditarSucursalDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
