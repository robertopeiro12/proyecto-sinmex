import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PresentacionEditadaDto {
  // Sin id = alta. Con id = la fila que ya existe. Quien no aparezca en la
  // lista se da de baja (D6).
  @IsOptional()
  @IsUUID()
  id?: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'La descripción del volumen es obligatoria.' })
  @MaxLength(40, { message: 'El volumen no puede pasar de 40 caracteres.' })
  volumen!: string;
}

export class EditarProductoDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del producto es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  // Sin `ArrayMinSize` aqui a proposito: la lista vacia tiene que llegar a
  // `reconciliarPresentaciones` para que el mensaje de error sea el mismo que
  // el de "te quedaste sin presentaciones", en vez de dos textos distintos
  // segun por donde entres.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PresentacionEditadaDto)
  presentaciones!: PresentacionEditadaDto[];
}
