import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  ValidateNested,
} from 'class-validator';
import { MENSAJE_AJUSTE_INVALIDO } from '../reglas-inventario-pt';

const MENSAJE_FORMATO_FECHA = 'La fecha debe tener el formato AAAA-MM-DD.';
const MENSAJE_SUCURSAL = 'La sucursal no es válida.';
const MENSAJE_PRESENTACION = 'Elige una presentación válida.';
const MENSAJE_PRODUCTO = 'Elige un producto válido.';

/** Tope tecnico de renglones por guardado (el catalogo real es mucho menor). */
const MAX_RENGLONES = 500;
/** El tope de una columna `integer`. */
const MAX_INTEGER_POSTGRES = 2_147_483_647;

/** `GET /inventario-pt`. Que la fecha exista y no sea futura lo comprueba el servicio. */
export class ConsultaInventarioPtDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  fecha!: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString({ message: MENSAJE_SUCURSAL })
  sucursal?: string;

  @IsOptional()
  @IsIn(['presentacion', 'producto'], {
    message: 'La vista debe ser por presentación o por producto.',
  })
  vista?: 'presentacion' | 'producto';
}

/** `GET /inventario-pt/historial`: una presentacion o un producto (uno de los dos). */
export class ConsultaHistorialPtDto {
  @IsOptional()
  @IsUUID(undefined, { message: MENSAJE_PRESENTACION })
  presentacion?: string;

  @IsOptional()
  @IsUUID(undefined, { message: MENSAJE_PRODUCTO })
  producto?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  desde!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  hasta!: string;

  @IsOptional()
  @IsString({ message: MENSAJE_SUCURSAL })
  sucursal?: string;
}

/** `GET /inventario-pt/descuentos`: una presentacion o un producto (uno de los dos). */
export class ConsultaDescuentosPtDto {
  @IsOptional()
  @IsUUID(undefined, { message: MENSAJE_PRESENTACION })
  presentacion?: string;

  @IsOptional()
  @IsUUID(undefined, { message: MENSAJE_PRODUCTO })
  producto?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  fecha!: string;

  @IsOptional()
  @IsString({ message: MENSAJE_SUCURSAL })
  sucursal?: string;
}

/** `GET /inventario-pt/ajustes`: la precarga de un dia en UNA sucursal. */
export class ConsultaAjustesPtDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  fecha!: string;

  @IsOptional()
  @IsString({ message: MENSAJE_SUCURSAL })
  sucursal?: string;
}

/** `DELETE /inventario-pt/ajustes`: da de baja el ajuste vivo de una presentacion en un dia. */
export class BorrarAjustePtDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  fecha!: string;

  @IsOptional()
  @IsString({ message: MENSAJE_SUCURSAL })
  sucursal?: string;

  @IsUUID(undefined, { message: MENSAJE_PRESENTACION })
  presentacionId!: string;
}

/** Un renglon del ajuste. Negativos los rechaza `validarAjustes` con su mensaje. */
export class RenglonAjustePtDto {
  @IsUUID(undefined, { message: 'Una de las presentaciones no es válida.' })
  presentacionId!: string;

  @IsInt({ message: MENSAJE_AJUSTE_INVALIDO })
  @Max(MAX_INTEGER_POSTGRES, { message: MENSAJE_AJUSTE_INVALIDO })
  inventarioInicial!: number;

  @IsInt({ message: MENSAJE_AJUSTE_INVALIDO })
  @Max(MAX_INTEGER_POSTGRES, { message: MENSAJE_AJUSTE_INVALIDO })
  mermaAcumuladaInicial!: number;
}

/** `PUT /inventario-pt/ajustes`: solo los renglones cambiados. */
export class GuardarAjustesPtDto {
  @IsString({ message: 'La fecha no es válida.' })
  fecha!: string;

  @IsOptional()
  @IsString({ message: MENSAJE_SUCURSAL })
  sucursal?: string;

  @IsArray({ message: 'Los renglones deben ser una lista.' })
  @ArrayMaxSize(MAX_RENGLONES, {
    message: `No se pueden guardar más de ${MAX_RENGLONES} presentaciones.`,
  })
  @IsObject({ each: true, message: 'Cada renglón debe ser un objeto.' })
  @ValidateNested({ each: true })
  @Type(() => RenglonAjustePtDto)
  renglones!: RenglonAjustePtDto[];

  @IsOptional()
  @IsString({ message: 'El comentario no es válido.' })
  comentario?: string | null;
}
