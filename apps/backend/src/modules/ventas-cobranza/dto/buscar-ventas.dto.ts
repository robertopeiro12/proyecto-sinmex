import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { LARGO_MAX_NUM_NOTA } from '../datos-venta';
import { recortar } from './registrar-venta.dto';

export const FILTROS_VENTAS = ['con_saldo', 'por_facturar', 'todas'] as const;
export type FiltroVentas = (typeof FILTROS_VENTAS)[number];

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /ventas` (T-17 parte 2, §3.1). Todo opcional: sin fechas, el servicio
 * usa hoy en Tijuana. Que el dia exista y que `desde <= hasta` lo decide el
 * servicio (`esFechaReal`).
 */
export class BuscarVentasDto {
  @IsOptional()
  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde?: string;

  @IsOptional()
  @Matches(RE_FECHA, {
    message: 'La fecha "hasta" debe tener el formato AAAA-MM-DD.',
  })
  hasta?: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'El cliente no es válido.' })
  clienteId?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUM_NOTA, {
    message: `El número de nota no puede pasar de ${LARGO_MAX_NUM_NOTA} caracteres.`,
  })
  numNota?: string;

  /** Folio exacto (Procesos): sin espacios y en mayúsculas; ignora las fechas. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value,
  )
  @IsString()
  @MaxLength(30, { message: 'El folio no puede pasar de 30 caracteres.' })
  folio?: string;

  /** `con_saldo` y `por_facturar` exigen `clienteId` e ignoran las fechas. */
  @IsOptional()
  @IsIn(FILTROS_VENTAS, { message: 'El filtro no es válido.' })
  filtro?: FiltroVentas;
}
