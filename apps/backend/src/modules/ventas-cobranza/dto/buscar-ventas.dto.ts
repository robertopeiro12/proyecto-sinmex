import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { LARGO_MAX_NUM_NOTA } from '../datos-venta';
import { recortar } from './registrar-venta.dto';

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
}
