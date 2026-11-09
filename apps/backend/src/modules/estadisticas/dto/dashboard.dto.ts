import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
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

/** `PUT /dashboard/notas-entregadas`: la casilla "Entregada" de las notas. */
export class NotasEntregadasDto {
  @IsUUID(undefined, { message: 'El vendedor no es válido.' })
  vendedor!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Marca al menos una nota.' })
  @ArrayMaxSize(200, { message: 'No más de 200 notas a la vez.' })
  @ValidateNested({ each: true })
  @Type(() => NotaEntregadaDto)
  notas!: NotaEntregadaDto[];
}
