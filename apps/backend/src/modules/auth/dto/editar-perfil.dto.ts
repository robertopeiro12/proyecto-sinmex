import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Un solo campo, y obligatorio: a diferencia de EditarVehiculoDto (que tiene
// varios campos opcionales), este PATCH solo renombra -- la baja es su
// propio DELETE (Task 5, porque `perfil` no tiene columna `activo`).
export class EditarPerfilDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del perfil es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;
}
