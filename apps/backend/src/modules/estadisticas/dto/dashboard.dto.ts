import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** `GET /dashboard`. Sin fecha: es siempre hoy. */
export class DashboardDto {
  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}

/** `GET /dashboard/vendedor`. El vendedor (uuid) lo valida el servicio. */
export class DashboardVendedorDto {
  @IsString()
  @IsNotEmpty({ message: 'Falta el vendedor.' })
  vendedor!: string;

  @IsOptional()
  @IsString()
  sucursal?: string;
}
