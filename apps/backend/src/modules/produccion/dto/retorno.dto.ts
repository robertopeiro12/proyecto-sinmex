import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { LineaProduccionDto } from './produccion.dto';

/**
 * Tope tecnico de lineas por guardado, el mismo de la produccion: el catalogo
 * real es mucho menor y la transaccion tiene al vendedor bloqueado.
 */
const MAX_LINEAS = 500;

const MENSAJE_VENDEDOR = 'Elige un vendedor válido.';

/** `GET /retornos`. Que la fecha exista lo comprueba el servicio. */
export class ConsultaRetornoDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  fecha!: string;

  @IsUUID(undefined, { message: MENSAJE_VENDEDOR })
  vendedor!: string;
}

/**
 * `PUT /retornos`: reemplaza el dia completo de un vendedor. No lleva sucursal:
 * la del retorno es siempre la del vendedor (la pone el servicio). Las lineas
 * tienen la misma forma que las de la produccion (uuid, entero, tope de la
 * columna); negativas o repetidas las rechaza `validarDia`.
 */
export class GuardarRetornoDto {
  @IsString({ message: 'La fecha no es válida.' })
  fecha!: string;

  @IsUUID(undefined, { message: MENSAJE_VENDEDOR })
  vendedor!: string;

  @IsArray({ message: 'Las líneas deben ser una lista.' })
  @ArrayMaxSize(MAX_LINEAS, {
    message: `No se pueden guardar más de ${MAX_LINEAS} líneas.`,
  })
  @IsObject({ each: true, message: 'Cada línea debe ser un objeto.' })
  @ValidateNested({ each: true })
  @Type(() => LineaProduccionDto)
  lineas!: LineaProduccionDto[];
}
