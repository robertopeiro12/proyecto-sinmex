import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAX_CENTAVOS_COBRO,
  METODOS_PAGO,
  type MetodoPago,
} from '../datos-cobranza';
import { LARGO_MAX_NUM_NOTA } from '../datos-venta';
import { recortar } from './registrar-venta.dto';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTAS = 200;

export const MENSAJE_MONTO =
  'El monto debe ser mayor a $0 y tener a lo más 2 decimales.';

/**
 * `GET /cobranzas/por-cobrar` (T-21, §4.3). Los tres filtros son opcionales
 * aqui; que venga **exactamente uno** lo exige el servicio.
 */
export class PorCobrarDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'El cliente no es válido.' })
  clienteId?: string;

  @IsOptional()
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUM_NOTA, {
    message: `El número de nota no puede pasar de ${LARGO_MAX_NUM_NOTA} caracteres.`,
  })
  numNota?: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}

/** Lo comun a la vista previa, el pago y el saldo a favor. */
export class NotasYMontoDto {
  @IsUUID(undefined, { message: 'Elige el cliente.' })
  clienteId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Marca al menos una nota.' })
  @ArrayMaxSize(MAX_NOTAS, {
    message: `No más de ${MAX_NOTAS} notas a la vez.`,
  })
  @IsUUID(undefined, { each: true, message: 'Una de las notas no es válida.' })
  notaIds!: string[];

  // Centavos ENTEROS: el portal convierte sin punto flotante
  // (`leerMontoCentavos`). Un numero con decimales o un texto es 400, nunca un
  // centavo de mas o de menos.
  @IsInt({ message: MENSAJE_MONTO })
  @Min(1, { message: MENSAJE_MONTO })
  @Max(MAX_CENTAVOS_COBRO, { message: 'El monto es demasiado grande.' })
  montoCentavos!: number;
}

/** `POST /cobranzas/vista-previa`: el reparto sin grabar (§3.3). */
export class VistaPreviaCobroDto extends NotasYMontoDto {
  @IsIn(['pago', 'saldo_favor'], {
    message: 'El modo debe ser pago o saldo_favor.',
  })
  modo!: 'pago' | 'saldo_favor';
}

/** `POST /cobranzas`: un pago de una o varias notas (§3.3). */
export class RegistrarCobroDto extends NotasYMontoDto {
  @Matches(RE_FECHA, {
    message: 'La fecha del pago debe tener el formato AAAA-MM-DD.',
  })
  fechaPago!: string;

  @IsIn(METODOS_PAGO, {
    message: 'El método de pago debe ser transferencia, efectivo o cheque.',
  })
  metodoPago!: MetodoPago;

  // Obligatorio, pero puede ser `null`: null es "Oficina". Ausente no es lo
  // mismo que Oficina, y se rechaza (mismo trato que la venta del portal).
  @ValidateIf((o: RegistrarCobroDto) => o.vendedorId !== null)
  @IsUUID(undefined, { message: 'Elige quién cobró: Oficina o un repartidor.' })
  vendedorId!: string | null;
}

/** `POST /cobranzas/saldo-favor`: sin metodo ni cobrador, no entra dinero (§3.4). */
export class AplicarSaldoFavorDto extends NotasYMontoDto {}
