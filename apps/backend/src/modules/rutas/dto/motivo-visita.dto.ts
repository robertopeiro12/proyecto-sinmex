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
 * Alta de un motivo de visita (T-39, D5). Las dos casillas son opcionales y
 * nacen en `false`, igual que en la base.
 */
export class CrearMotivoVisitaDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del motivo es obligatorio.' })
  // La columna no tiene tope; el de aqui es el mismo de los demas catalogos
  // que se pintan en una lista (vehiculo, tipo de negocio).
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  @IsOptional()
  @IsBoolean({ message: '"Exige foto" tiene que ser sí o no.' })
  exigeFoto?: boolean;

  @IsOptional()
  @IsBoolean({
    message: '"Exige nombre de quien atendió" tiene que ser sí o no.',
  })
  exigeAtendio?: boolean;
}

/** Edicion parcial: el servicio rechaza con 400 un cuerpo sin ningun campo. */
export class EditarMotivoVisitaDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del motivo es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsBoolean({ message: '"Exige foto" tiene que ser sí o no.' })
  exigeFoto?: boolean;

  @IsOptional()
  @IsBoolean({
    message: '"Exige nombre de quien atendió" tiene que ser sí o no.',
  })
  exigeAtendio?: boolean;
}
