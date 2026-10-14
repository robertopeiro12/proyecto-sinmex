import { IsOptional, IsString, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /reportes/clientes-nuevos` (T-51). El rango lo termina de validar `validarRango`. */
export class ReporteClientesNuevosDto {
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
}
