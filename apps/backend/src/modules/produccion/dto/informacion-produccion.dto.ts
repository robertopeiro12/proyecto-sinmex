import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const MENSAJE_FORMATO_FECHA = 'La fecha debe tener el formato AAAA-MM-DD.';
const MENSAJE_SUCURSAL = 'La sucursal no es válida.';

/** `GET /informacion-produccion`. Que las fechas existan y el rango sea valido lo comprueba el servicio. */
export class ConsultaInformacionProduccionDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  desde!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  hasta!: string;

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

/** `GET /informacion-produccion/detalle`: una presentacion o un producto (uno de los dos). */
export class ConsultaDetalleInformacionProduccionDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'Elige una presentación válida.' })
  presentacion?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige un producto válido.' })
  producto?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  desde!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  hasta!: string;

  @IsOptional()
  @IsString({ message: MENSAJE_SUCURSAL })
  sucursal?: string;
}
