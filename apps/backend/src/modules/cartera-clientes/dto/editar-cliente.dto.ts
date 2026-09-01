import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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
import { OverridePrecioDto } from './override-precio.dto';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Mismos campos que `CrearClienteDto`, MENOS `tipo` y `sucursalId` (D6 del
 * spec): la sucursal de un cliente no se cambia, y reclasificar
 * Cliente<->Prospecto no lo pide el issue. El resto de los campos base son
 * obligatorios y no opcionales -- el formulario manda el estado COMPLETO en
 * cada guardado (mismo criterio que `EditarProductoDto` de T-10, a
 * diferencia de `EditarVehiculoDto` de T-11, que sí es un PATCH parcial de
 * campos independientes).
 */
export class EditarClienteDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El domicilio es obligatorio.' })
  @MaxLength(200, { message: 'El domicilio no puede pasar de 200 caracteres.' })
  domicilio!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El teléfono es obligatorio.' })
  @MaxLength(30, { message: 'El teléfono no puede pasar de 30 caracteres.' })
  telefono!: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(120, {
    message: 'El nombre del encargado no puede pasar de 120 caracteres.',
  })
  encargado?: string;

  @IsBoolean()
  factura!: boolean;

  @IsOptional()
  @IsUUID()
  tipoNegocioId?: string;

  @IsUUID()
  listaPrecioId!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'El % de comisión no puede ser negativo.' })
  @Max(100, { message: 'El % de comisión no puede pasar de 100.' })
  pctComision?: number;

  @IsIn(['ninguna', '10+1', '20+1'], {
    message: 'La promoción debe ser "ninguna", "10+1" o "20+1".',
  })
  promocion!: 'ninguna' | '10+1' | '20+1';

  @IsArray()
  @IsUUID(undefined, { each: true })
  productosPromocion!: string[];

  @IsOptional()
  @IsInt()
  @Min(0, { message: 'El plazo de crédito no puede ser negativo.' })
  @Max(36500, {
    message: 'El plazo de crédito no puede pasar de 36,500 días.',
  })
  plazoCreditoDias?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(2000, {
    message: 'Los comentarios no pueden pasar de 2000 caracteres.',
  })
  comentarios?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverridePrecioDto)
  overridesPrecio!: OverridePrecioDto[];

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  vigenteDesde!: string;
}
