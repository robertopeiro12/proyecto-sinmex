import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Alta de un motivo de merma (Registro de Operacion, D7). Las tres casillas
 * nacen prendidas; el servicio rechaza con 400 dejarlas todas apagadas.
 */
export class CrearMotivoMermaDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del motivo es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  @IsOptional()
  @IsBoolean({ message: '"Almacén" tiene que ser sí o no.' })
  aplicaAlmacen?: boolean;

  @IsOptional()
  @IsBoolean({ message: '"Cliente" tiene que ser sí o no.' })
  aplicaCliente?: boolean;

  @IsOptional()
  @IsBoolean({ message: '"Vehículo" tiene que ser sí o no.' })
  aplicaVehiculo?: boolean;
}

/** Edicion parcial: el servicio rechaza con 400 un cuerpo sin ningun campo. */
export class EditarMotivoMermaDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del motivo es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsBoolean({ message: '"Almacén" tiene que ser sí o no.' })
  aplicaAlmacen?: boolean;

  @IsOptional()
  @IsBoolean({ message: '"Cliente" tiene que ser sí o no.' })
  aplicaCliente?: boolean;

  @IsOptional()
  @IsBoolean({ message: '"Vehículo" tiene que ser sí o no.' })
  aplicaVehiculo?: boolean;
}
