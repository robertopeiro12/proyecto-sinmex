import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
