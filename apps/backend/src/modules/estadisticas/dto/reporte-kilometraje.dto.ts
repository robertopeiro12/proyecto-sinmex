import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /reportes/kilometraje` (T-50). El formato lo valida aqui; que el dia
 * exista, el orden y el tope de un año, `validarRango` (reglas-kilometraje.ts).
 */
export class ReporteKilometrajeDto {
  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde!: string;

  @Matches(RE_FECHA, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  hasta!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'El vehículo no es válido.' })
  vehiculo?: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}
