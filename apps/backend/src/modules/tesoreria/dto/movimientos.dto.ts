import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_CENTAVOS_TESORERIA } from '../reglas-saldo';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MENSAJE_MONTO =
  'El monto debe ser mayor a $0 y tener a lo más 2 decimales.';

/** '' y solo espacios -> undefined: el comentario es null o tiene texto. */
const recortarOVacio = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const limpio = value.trim();
  return limpio === '' ? undefined : limpio;
};

export class CrearMovimientoDto {
  @IsIn(['deposito', 'retiro', 'traspaso'], {
    message: 'El tipo debe ser depósito, retiro o traspaso.',
  })
  tipo!: 'deposito' | 'retiro' | 'traspaso';

  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;

  @IsInt({ message: MENSAJE_MONTO })
  @Min(1, { message: MENSAJE_MONTO })
  @Max(MAX_CENTAVOS_TESORERIA, { message: 'El monto es demasiado grande.' })
  montoCentavos!: number;

  @IsUUID(undefined, { message: 'La cuenta no es válida.' })
  cuentaId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'La cuenta destino no es válida.' })
  cuentaDestinoId?: string;

  @IsOptional()
  @Transform(recortarOVacio)
  @IsString()
  @MaxLength(200, {
    message: 'El comentario no puede pasar de 200 caracteres.',
  })
  comentario?: string;
}

/**
 * Corregir: fecha, monto, cuenta(s) y comentario. El tipo NO se cambia (spec §3.1).
 * `comentario: ''` borra el comentario: por eso aqui no se transforma a
 * undefined sino que el servicio distingue "no vino" de "vino vacio".
 */
export class EditarMovimientoDto {
  @IsOptional()
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha?: string;

  @IsOptional()
  @IsInt({ message: MENSAJE_MONTO })
  @Min(1, { message: MENSAJE_MONTO })
  @Max(MAX_CENTAVOS_TESORERIA, { message: 'El monto es demasiado grande.' })
  montoCentavos?: number;

  @IsOptional()
  @IsUUID(undefined, { message: 'La cuenta no es válida.' })
  cuentaId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'La cuenta destino no es válida.' })
  cuentaDestinoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, {
    message: 'El comentario no puede pasar de 200 caracteres.',
  })
  comentario?: string;
}

export class ListarMovimientosDto {
  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde!: string;

  @Matches(RE_FECHA, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  hasta!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  sucursal?: string;
}
