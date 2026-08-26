import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearPerfilDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del perfil es obligatorio.' })
  // La columna es `text` (sin limite). El tope vive aqui por la misma razon
  // que sucursal/producto/vehiculo: sin cota, es una invitacion a meter un
  // texto largo en un catalogo que se pinta como columna de tabla.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;
}
