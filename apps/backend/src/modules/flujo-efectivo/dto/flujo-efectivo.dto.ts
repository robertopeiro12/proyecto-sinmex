import { IsOptional, IsString, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class FlujoEfectivoDto {
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
