import { IsIn, IsOptional, IsString } from 'class-validator';

/** `GET /cuentas-por-cobrar` (T-22). */
export class CuentasPorCobrarDto {
  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;

  @IsOptional()
  @IsIn(['true', 'false'], {
    message: '"soloVencidas" debe ser true o false.',
  })
  soloVencidas?: string;
}
