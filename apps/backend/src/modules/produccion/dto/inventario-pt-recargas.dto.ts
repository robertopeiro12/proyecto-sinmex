import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const MENSAJE_SUCURSAL = 'La sucursal no es válida.';

/** `GET /inventario-pt/recargas`: siempre hoy de Tijuana (no lleva fecha). */
export class ConsultaInventarioPtRecargasDto {
  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString({ message: MENSAJE_SUCURSAL })
  sucursal?: string;

  @IsOptional()
  @IsIn(['presentacion', 'producto'], {
    message: 'La vista debe ser por presentación o por producto.',
  })
  vista?: 'presentacion' | 'producto';
}

/** `GET /inventario-pt/recargas/detalle`: una presentacion o un producto (uno de los dos). */
export class ConsultaDetallePtRecargasDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'Elige una presentación válida.' })
  presentacion?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige un producto válido.' })
  producto?: string;

  @IsOptional()
  @IsString({ message: MENSAJE_SUCURSAL })
  sucursal?: string;

  @IsIn(['recargas', 'descuentos'], {
    message: 'La columna debe ser recargas o descuentos.',
  })
  columna!: 'recargas' | 'descuentos';
}
