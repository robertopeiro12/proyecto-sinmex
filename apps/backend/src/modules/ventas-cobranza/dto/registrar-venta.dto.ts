import { Transform, Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import {
  LARGO_MAX_COMENTARIOS,
  LARGO_MAX_NUM_NOTA,
  MAX_LINEAS_VENTA,
} from '../datos-venta';

export const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `integer` de Postgres. */
const MAX_PIEZAS = 2_147_483_647;

/** Una linea de la venta. **Sin precio**: lo pone el servidor (§4.2). */
export class LineaVentaDto {
  @IsUUID(undefined, { message: 'Cada línea necesita una presentación.' })
  presentacionId!: string;

  @IsInt({ message: 'La cantidad debe ser un número entero de piezas.' })
  @Min(0, { message: 'La cantidad no puede ser negativa.' })
  @Max(MAX_PIEZAS)
  cantidad!: number;

  @IsInt({ message: 'Las piezas de promoción deben ser un número entero.' })
  @Min(0, { message: 'Las piezas de promoción no pueden ser negativas.' })
  @Max(MAX_PIEZAS)
  cantidadPromocion!: number;
}

/**
 * Lo que se captura de una venta en el portal, al registrarla y al editarla
 * (T-17). Las reglas de fondo (presentacion repetida, linea en 0, precio a la
 * fecha) las decide el servicio con las mismas funciones que la tablet; aqui
 * solo la forma.
 */
export class CamposVentaDto {
  // Obligatorio, pero puede ser `null`: null es "Oficina" (venta de
  // mostrador). Ausente no es lo mismo que Oficina, y se rechaza.
  @ValidateIf((o: CamposVentaDto) => o.vendedorId !== null)
  @IsUUID(undefined, {
    message: 'Elige el repartidor: un vendedor, u Oficina.',
  })
  vendedorId!: string | null;

  // Opcional: solo se captura si hubo nota de papel (cliente, 2026-10-06).
  // En blanco es lo mismo que sin nota; `normalizarDatosVenta` lo deja en null.
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_NUM_NOTA, {
    message: `El número de nota no puede pasar de ${LARGO_MAX_NUM_NOTA} caracteres.`,
  })
  numNota?: string | null;

  @IsIn(['contado', 'credito'], {
    message: 'La venta debe ser de contado o de crédito.',
  })
  contadoCredito!: 'contado' | 'credito';

  /** Solo cuenta en contado; por default transferencia (§2). */
  @IsOptional()
  @IsIn(['transferencia', 'efectivo'], {
    message: 'El método de pago debe ser transferencia o efectivo.',
  })
  metodoPago?: 'transferencia' | 'efectivo';

  /** Asignar el numero de factura es T-19. */
  @IsIn(['N/A', 'pendiente'], {
    message: 'La factura solo puede ser N/A o pendiente.',
  })
  factura!: 'N/A' | 'pendiente';

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(LARGO_MAX_COMENTARIOS, {
    message: `Los comentarios no pueden pasar de ${LARGO_MAX_COMENTARIOS} caracteres.`,
  })
  comentarios?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Captura al menos un producto.' })
  @ArrayMaxSize(MAX_LINEAS_VENTA, {
    message: `Una venta no puede traer más de ${MAX_LINEAS_VENTA} productos.`,
  })
  @ValidateNested({ each: true })
  @Type(() => LineaVentaDto)
  lineas!: LineaVentaDto[];
}

/** `POST /ventas` (T-17, §4.2): los campos de la venta mas su fecha y su cliente. */
export class RegistrarVentaDto extends CamposVentaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  fecha!: string;

  @IsUUID(undefined, { message: 'Elige el cliente.' })
  clienteId!: string;
}
