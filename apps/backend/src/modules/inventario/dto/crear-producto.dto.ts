import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PresentacionDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'La descripción del volumen es obligatoria.' })
  // La columna es `text` (sin limite). El tope vive aqui por la misma razon
  // que en CrearSucursalDto: un campo sin cota en algo que se pinta en una
  // tabla es una invitacion a meter un documento entero.
  @MaxLength(40, { message: 'El volumen no puede pasar de 40 caracteres.' })
  volumen!: string;
}

export class CrearProductoDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del producto es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  // `ArrayMinSize(1)` es donde vive D8 para el alta: un producto sin
  // presentaciones no se puede vender ni poner precio. En el PATCH la misma
  // regla la hace cumplir `reconciliarPresentaciones`.
  @IsArray()
  @ArrayMinSize(1, {
    message: 'El producto debe tener al menos una presentación.',
  })
  @ValidateNested({ each: true })
  @Type(() => PresentacionDto)
  presentaciones!: PresentacionDto[];
}
