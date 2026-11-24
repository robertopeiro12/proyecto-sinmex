import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  IsNotEmpty,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_MOTIVO_RECHAZO,
  MENSAJE_MOTIVO_RECHAZO,
  MENSAJE_MOTIVO_RECHAZO_LARGO,
  MENSAJE_PIEZAS,
  TIPOS_OPERACION,
} from '../reglas-operacion';

/** El tope de la columna `piezas` (integer): mas alla seria un 500, no un 400. */
const MAX_INTEGER_POSTGRES = 2_147_483_647;

const MENSAJE_TIPO = 'Elige el tipo de operación.';
const MENSAJE_FORMATO_FECHA = 'La fecha debe tener el formato AAAA-MM-DD.';

/** Un texto opcional: `null` o vacio cuentan como "sin dato". */
const recortarONulo = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

/** `GET /operaciones-almacen`. Que la fecha exista lo comprueba el servicio. */
export class ConsultaOperacionesDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  fecha!: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString({ message: 'La sucursal no es válida.' })
  sucursal?: string;

  @IsIn(TIPOS_OPERACION, { message: MENSAJE_TIPO })
  tipo!: (typeof TIPOS_OPERACION)[number];
}

/** Una presentacion de la captura. Rango y repetidas: `validarOperacion`. */
export class LineaOperacionDto {
  @IsUUID(undefined, { message: 'Una de las presentaciones no es válida.' })
  presentacionId!: string;

  @IsInt({ message: MENSAJE_PIEZAS })
  @Max(MAX_INTEGER_POSTGRES, { message: MENSAJE_PIEZAS })
  piezas!: number;
}

/** `PUT /operaciones-almacen/:id`: reemplaza los datos y las lineas. */
export class EditarOperacionDto {
  @IsString({ message: 'La fecha no es válida.' })
  fecha!: string;

  @IsOptional()
  @IsString({ message: 'El origen no es válido.' })
  origen?: string;

  /** Codigo de la sucursal de destino (solo en un envio). */
  @IsOptional()
  @IsString({ message: 'El destino no es válido.' })
  destino?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'El motivo no es válido.' })
  motivoId?: string;

  @IsOptional()
  @Transform(recortarONulo)
  @IsString({ message: 'El nombre del trabajador no es válido.' })
  trabajador?: string | null;

  @IsOptional()
  @Transform(recortarONulo)
  @IsString({ message: 'El comentario no es válido.' })
  comentario?: string | null;

  @IsArray({ message: 'Las presentaciones deben ser una lista.' })
  @IsObject({ each: true, message: 'Cada presentación debe ser un objeto.' })
  @ValidateNested({ each: true })
  @Type(() => LineaOperacionDto)
  lineas!: LineaOperacionDto[];
}

/** `POST /operaciones-almacen`. */
export class CrearOperacionDto extends EditarOperacionDto {
  @IsIn(TIPOS_OPERACION, { message: MENSAJE_TIPO })
  tipo!: (typeof TIPOS_OPERACION)[number];

  /** Codigo de la sucursal donde se registra (la que manda, en un envio). */
  @IsString({ message: 'Elige la sucursal.' })
  sucursal!: string;
}

/** `GET /operaciones-almacen/retiros-pendientes`. */
export class ConsultaRetirosPendientesDto {
  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString({ message: 'La sucursal no es válida.' })
  sucursal?: string;
}

/** `POST /operaciones-almacen/:id/rechazar`. */
export class RechazarRetiroDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: MENSAJE_MOTIVO_RECHAZO })
  @IsNotEmpty({ message: MENSAJE_MOTIVO_RECHAZO })
  @MaxLength(MAX_MOTIVO_RECHAZO, { message: MENSAJE_MOTIVO_RECHAZO_LARGO })
  motivo!: string;
}
