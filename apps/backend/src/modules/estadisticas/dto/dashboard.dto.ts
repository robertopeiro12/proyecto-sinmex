import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** `GET /dashboard`. Sin fecha: es siempre hoy. */
export class DashboardDto {
  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}

/**
 * `GET /dashboard/vendedor`. El vendedor (uuid) y la fecha (hoy o ayer de
 * Tijuana; sin ella, hoy) los valida el servicio.
 */
export class DashboardVendedorDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta el vendedor.' })
  vendedor!: string;

  /** La del Dashboard que se esta viendo: su detalle no cambia de dia a la medianoche. */
  @IsOptional()
  @IsString()
  fecha?: string;

  @IsOptional()
  @IsString()
  sucursal?: string;
}

export class NotaEntregadaDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta el folio.' })
  @MaxLength(40, { message: 'El folio no es válido.' })
  folio!: string;

  @IsBoolean({ message: 'Entregada debe ser sí o no.' })
  entregada!: boolean;
}

export class AsignadaEntregadaDto {
  @IsUUID(undefined, { message: 'La nota asignada no es válida.' })
  ventaNotaId!: string;

  @IsBoolean({ message: 'Entregada debe ser sí o no.' })
  entregada!: boolean;
}

/**
 * `PUT /dashboard/notas-entregadas`: la revision de papel de la tarde. Las
 * ventas a credito del dia van por folio en `notas`; las asignadas, por venta
 * en `asignadas`. `fecha` (`AAAA-MM-DD`; que sea hoy o ayer de Tijuana lo
 * valida el servicio); sin ella, hoy y la forma vieja para `notas`. Al menos una nota entre las dos
 * listas (tambien lo revisa el servicio).
 */
export class NotasEntregadasDto {
  @IsUUID(undefined, { message: 'El vendedor no es válido.' })
  vendedor!: string;

  /** Vacia no es "hoy": si viene, tiene que ser `AAAA-MM-DD`. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha no es válida.' })
  fecha?: string;

  @IsArray()
  @ArrayMaxSize(200, { message: 'No más de 200 notas a la vez.' })
  @ValidateNested({ each: true })
  @Type(() => NotaEntregadaDto)
  notas!: NotaEntregadaDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200, { message: 'No más de 200 notas asignadas a la vez.' })
  @ValidateNested({ each: true })
  @Type(() => AsignadaEntregadaDto)
  asignadas?: AsignadaEntregadaDto[];
}
