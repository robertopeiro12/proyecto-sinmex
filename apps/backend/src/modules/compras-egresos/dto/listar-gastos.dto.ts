import { IsOptional, IsString, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /gastos` (T-30/T-31, D10). El formato lo valida aqui; que el dia exista,
 * el orden y el tope de un año, `validarRango` (reglas-kilometraje.ts), como el
 * Reporte de Ventas. Vendedor y campo (uuid) los valida el servicio.
 */
export class ListarGastosDto {
  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde!: string;

  @Matches(RE_FECHA, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  hasta!: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;

  /** Id del vendedor. */
  @IsOptional()
  @IsString()
  vendedor?: string;

  /** Id del campo de egreso. */
  @IsOptional()
  @IsString()
  campo?: string;
}
