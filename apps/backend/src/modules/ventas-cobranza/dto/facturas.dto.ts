import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { LARGO_MAX_NUMERO_FACTURA } from '../facturas';
import { recortar } from './registrar-venta.dto';

const MAX_VENTAS = 200;

export class PorFacturarDto {
  @IsUUID(undefined, { message: 'Elige el cliente.' })
  clienteId!: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  incluirNA?: string;
}

export class AsignarFacturaDto {
  @IsUUID(undefined, { message: 'Elige el cliente.' })
  clienteId!: string;

  // El largo exacto (1..30 tras recortar) lo decide `normalizarNumeroFactura`.
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUMERO_FACTURA, {
    message: `El número de factura debe tener de 1 a ${LARGO_MAX_NUMERO_FACTURA} caracteres.`,
  })
  numero!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Marca al menos una venta.' })
  @ArrayMaxSize(MAX_VENTAS, {
    message: `No más de ${MAX_VENTAS} ventas por factura a la vez.`,
  })
  @IsUUID(undefined, { each: true, message: 'Una de las ventas no es válida.' })
  ventaIds!: string[];
}

export class RenombrarFacturaDto {
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUMERO_FACTURA, {
    message: `El número de factura debe tener de 1 a ${LARGO_MAX_NUMERO_FACTURA} caracteres.`,
  })
  numero!: string;
}

export class QuitarVentasDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Marca al menos una venta.' })
  @ArrayMaxSize(MAX_VENTAS)
  @IsUUID(undefined, { each: true, message: 'Una de las ventas no es válida.' })
  ventaIds!: string[];
}

export class BuscarFacturasDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUMERO_FACTURA)
  numero?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'El cliente no es válido.' })
  clienteId?: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}
