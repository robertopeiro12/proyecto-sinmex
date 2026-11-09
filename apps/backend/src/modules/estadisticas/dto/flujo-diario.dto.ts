import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /reportes/flujo-diario`. El formato lo valida aqui; que el dia exista,
 * el orden y el tope de un año, `validarRango` (reglas-kilometraje.ts). El
 * vendedor (uuid) lo valida el servicio.
 */
export class FlujoDiarioDto {
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

  /** Id de un vendedor. */
  @IsOptional()
  @IsString()
  vendedor?: string;
}

/** `GET /reportes/flujo-diario/vendedor`: un vendedor en un dia. */
export class DetalleVendedorDto {
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;

  @IsString()
  @IsNotEmpty({ message: 'Falta el vendedor.' })
  vendedor!: string;

  @IsOptional()
  @IsString()
  sucursal?: string;
}

/**
 * `GET /reportes/flujo-diario/dia`: una sucursal en un dia. Con `vendedor`
 * (uuid, lo valida el servicio), solo lo de ese vendedor y sin la oficina.
 */
export class DetalleDiaDto {
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;

  @IsString()
  @IsNotEmpty({ message: 'Falta la sucursal.' })
  sucursal!: string;

  @IsOptional()
  @IsString()
  vendedor?: string;
}
