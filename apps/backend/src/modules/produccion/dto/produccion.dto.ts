import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  ValidateNested,
} from 'class-validator';
import { MENSAJE_PIEZAS_INVALIDAS } from '../reglas-produccion';

/** El tope de la columna `produccion.piezas` (integer): mas alla seria un 500. */
const MAX_INTEGER_POSTGRES = 2_147_483_647;

/** `GET /produccion` (T-25). Que la fecha exista lo comprueba el servicio. */
export class ConsultaProduccionDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  fecha!: string;

  /**
   * Codigo de la sucursal. Obligatorio para un usuario General; uno atado ve la
   * suya (pedir otra es 404, no 403: no se confirma que exista).
   */
  @IsOptional()
  @IsString({ message: 'La sucursal no es válida.' })
  sucursal?: string;
}

/**
 * Una presentacion del dia. 0 = sin registro (da de baja la fila viva). Que no
 * sea negativa, ni repetida, lo dicen las reglas (`validarDia`) con su mensaje;
 * aqui solo la forma y el tope de la columna.
 */
export class LineaProduccionDto {
  @IsUUID(undefined, { message: 'Una de las presentaciones no es válida.' })
  presentacionId!: string;

  @IsInt({ message: MENSAJE_PIEZAS_INVALIDAS })
  @Max(MAX_INTEGER_POSTGRES, { message: MENSAJE_PIEZAS_INVALIDAS })
  piezas!: number;
}

/** `PUT /produccion`: reemplaza el dia completo de una sucursal. */
export class GuardarProduccionDto {
  @IsString({ message: 'La fecha no es válida.' })
  fecha!: string;

  @IsString({ message: 'Elige la sucursal.' })
  sucursal!: string;

  @IsArray({ message: 'Las líneas deben ser una lista.' })
  @IsObject({ each: true, message: 'Cada línea debe ser un objeto.' })
  @ValidateNested({ each: true })
  @Type(() => LineaProduccionDto)
  lineas!: LineaProduccionDto[];
}
