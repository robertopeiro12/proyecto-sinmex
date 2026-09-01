import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearTipoNegocioDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  // Mismo tope que sucursal/producto/vehiculo (T-09/T-10/T-11): un campo de
  // texto sin cota es una invitacion a meter un documento entero en un
  // catalogo que se pinta en un desplegable.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;
}
