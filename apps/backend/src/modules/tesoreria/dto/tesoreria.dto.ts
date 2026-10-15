import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_CENTAVOS_TESORERIA } from '../reglas-saldo';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILAS_LOTE = 200;

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** '' y solo espacios -> undefined: el comentario es null o tiene texto (spec §3.3). */
const recortarOVacio = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const limpio = value.trim();
  return limpio === '' ? undefined : limpio;
};

export class CrearCuentaDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre de la cuenta es obligatorio.' })
  @MaxLength(60, { message: 'El nombre no puede pasar de 60 caracteres.' })
  nombre!: string;

  // Solo lo usa un General (ausente = cuenta general). A un usuario atado se le
  // IGNORA: la sucursal la pone el servidor (spec §3.2), como en vehiculos.
  @IsOptional()
  @IsUUID(undefined, { message: 'La sucursal no es válida.' })
  sucursalId?: string;
}

export class RenombrarCuentaDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre de la cuenta es obligatorio.' })
  @MaxLength(60, { message: 'El nombre no puede pasar de 60 caracteres.' })
  nombre!: string;
}

export class SaldosDelDiaDto {
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}

export class FilaSaldoDto {
  @IsUUID(undefined, { message: 'Una de las cuentas no es válida.' })
  cuentaId!: string;

  // Centavos ENTEROS y con signo (un banco puede estar sobregirado).
  @IsInt({ message: 'El monto debe tener a lo más 2 decimales.' })
  @Min(-MAX_CENTAVOS_TESORERIA, { message: 'El monto es demasiado grande.' })
  @Max(MAX_CENTAVOS_TESORERIA, { message: 'El monto es demasiado grande.' })
  montoCentavos!: number;

  @IsOptional()
  @Transform(recortarOVacio)
  @IsString()
  @MaxLength(200, {
    message: 'El comentario no puede pasar de 200 caracteres.',
  })
  comentario?: string;
}

export class GuardarSaldosDto {
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Captura al menos un saldo.' })
  @ArrayMaxSize(MAX_FILAS_LOTE, {
    message: `No más de ${MAX_FILAS_LOTE} saldos a la vez.`,
  })
  @ValidateNested({ each: true })
  @Type(() => FilaSaldoDto)
  saldos!: FilaSaldoDto[];
}

export class VistaTesoreriaDto {
  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde!: string;

  @Matches(RE_FECHA, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  hasta!: string;

  @IsOptional()
  @IsString()
  sucursal?: string;
}
