import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TIPOS_EGRESO, type TipoEgreso } from '../tipos-egreso';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const MENSAJE_TIPO =
  'El tipo tiene que ser Producción, Operación o Financiero.';

/** Alta de un campo de egreso (T-30, D3). La casilla nace en `false`, igual que en la base. */
export class CrearCampoEgresoDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del campo es obligatorio.' })
  // Mismo tope que los demas catalogos que se pintan en una lista.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  @IsIn(TIPOS_EGRESO, { message: MENSAJE_TIPO })
  tipo!: TipoEgreso;

  @IsOptional()
  @IsBoolean({ message: '"Se usa en la app" tiene que ser sí o no.' })
  seUsaEnApp?: boolean;
}

/** Edicion parcial: el servicio rechaza con 400 un cuerpo sin ningun campo. */
export class EditarCampoEgresoDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del campo es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsIn(TIPOS_EGRESO, { message: MENSAJE_TIPO })
  tipo?: TipoEgreso;

  @IsOptional()
  @IsBoolean({ message: '"Se usa en la app" tiene que ser sí o no.' })
  seUsaEnApp?: boolean;
}
