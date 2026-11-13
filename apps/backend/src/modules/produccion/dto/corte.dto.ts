import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { MENSAJE_CONTEO_INVALIDO } from '../reglas-corte';

/**
 * Tope tecnico de lineas por guardado, el mismo de la produccion: el catalogo
 * real es mucho menor y la transaccion tiene al vendedor bloqueado.
 */
const MAX_LINEAS = 500;

/** El tope de las columnas `retorno.piezas`/`piezas_merma` (integer). */
const MAX_INTEGER_POSTGRES = 2_147_483_647;

const MENSAJE_VENDEDOR = 'Elige un vendedor válido.';
const MENSAJE_FORMATO_FECHA = 'La fecha debe tener el formato AAAA-MM-DD.';

/** `GET /cortes`: la lista del dia. Que la fecha exista lo comprueba el servicio. */
export class ConsultaCortesDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  fecha!: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString({ message: 'La sucursal no es válida.' })
  sucursal?: string;
}

/** `GET /cortes/vendedor`: el corte de un vendedor y un dia. */
export class ConsultaCorteVendedorDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  fecha!: string;

  @IsUUID(undefined, { message: MENSAJE_VENDEDOR })
  vendedor!: string;
}

/**
 * Una presentacion contada. 0/0 (o ausente) = sin registro. Negativas o
 * repetidas las rechaza `validarCorte` con su mensaje; aqui la forma y el tope.
 */
export class LineaCorteDto {
  @IsUUID(undefined, { message: 'Una de las presentaciones no es válida.' })
  presentacionId!: string;

  @IsInt({ message: MENSAJE_CONTEO_INVALIDO })
  @Max(MAX_INTEGER_POSTGRES, { message: MENSAJE_CONTEO_INVALIDO })
  buenas!: number;

  @IsInt({ message: MENSAJE_CONTEO_INVALIDO })
  @Max(MAX_INTEGER_POSTGRES, { message: MENSAJE_CONTEO_INVALIDO })
  merma!: number;
}

/**
 * `PUT /cortes/vendedor`: reemplaza el conteo del dia de un vendedor y deja el
 * corte hecho (aunque no venga ninguna pieza). No lleva sucursal: es la del
 * vendedor (la pone el servicio).
 */
export class GuardarCorteDto {
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
  @Type(() => LineaCorteDto)
  lineas!: LineaCorteDto[];
}
