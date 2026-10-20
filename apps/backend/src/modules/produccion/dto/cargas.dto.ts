import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_LINEAS_CARGA, MAX_PIEZAS_LINEA } from '../reglas-carga';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PIEZAS = 'Las piezas son enteras, de 1 a 99 999.';
const VERSION = 'Falta la versión de la carga.';

/** `GET /cargas` (T-27). Que la fecha exista lo comprueba el servicio. */
export class ConsultaCargasDto {
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;

  /**
   * Id de la sucursal. Obligatoria para un usuario General; uno atado ve la suya
   * (pedir otra es 404, no 403: no se confirma que exista).
   */
  @IsOptional()
  @IsUUID(undefined, { message: 'La sucursal no es válida.' })
  sucursal?: string;
}

export class LineaCargaDto {
  @IsUUID(undefined, { message: 'Uno de los productos no es válido.' })
  presentacionId!: string;

  @IsInt({ message: PIEZAS })
  @Min(1, { message: PIEZAS })
  @Max(MAX_PIEZAS_LINEA, { message: PIEZAS })
  piezas!: number;
}

class LineasCargaDto {
  @IsArray({ message: 'Las líneas de la carga deben ser una lista.' })
  @ArrayMinSize(1, { message: 'La carga necesita al menos un producto.' })
  @ArrayMaxSize(MAX_LINEAS_CARGA, {
    message: `Una carga lleva hasta ${MAX_LINEAS_CARGA} productos.`,
  })
  @ValidateNested({ each: true })
  @Type(() => LineaCargaDto)
  lineas!: LineaCargaDto[];
}

/** `POST /cargas`: la carga de HOY en Tijuana (D8); el numero lo pone el servidor. */
export class CrearCargaDto extends LineasCargaDto {
  @IsUUID(undefined, { message: 'Elige el vendedor.' })
  vendedorId!: string;
}

/** `PATCH /cargas/:id`: reemplaza las lineas y la regresa a pendiente (D5). */
export class EditarCargaDto extends LineasCargaDto {
  @IsInt({ message: VERSION })
  @Min(1, { message: VERSION })
  version!: number;
}

/** `DELETE /cargas/:id`. */
export class VersionCargaDto {
  @IsInt({ message: VERSION })
  @Min(1, { message: VERSION })
  version!: number;
}

/**
 * `POST /sync/cargas/:id/respuesta` (Tarea 3). `motivo` se declara aunque
 * `aceptar` no lo lleve: con `whitelist` un campo no declarado se borraria sin
 * aviso, y "aceptar con motivo" debe ser 400 (spec).
 */
export class RespuestaCargaDto {
  @IsInt({ message: VERSION })
  @Min(1, { message: VERSION })
  version!: number;

  @IsIn(['aceptar', 'rechazar'], {
    message: 'La acción debe ser aceptar o rechazar.',
  })
  accion!: 'aceptar' | 'rechazar';

  @IsOptional()
  @IsString({ message: 'El motivo debe ser texto.' })
  motivo?: string;
}
