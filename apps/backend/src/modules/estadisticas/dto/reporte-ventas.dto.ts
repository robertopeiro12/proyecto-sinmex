import { IsOptional, IsString, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /reportes/ventas` (T-49). El formato lo valida aqui; que el dia exista,
 * el orden y el tope de un año, `validarRango` (reglas-kilometraje.ts). El
 * repartidor (uuid u `oficina`) lo valida el servicio.
 */
export class ReporteVentasDto {
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

  /** Id de vendedor u `oficina` (ventas sin vendedor). */
  @IsOptional()
  @IsString()
  repartidor?: string;
}
