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

export class CrearClienteDto {
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

  @IsIn(['cliente', 'prospecto'], {
    message: 'El tipo debe ser "cliente" o "prospecto".',
  })
  tipo!: 'cliente' | 'prospecto';

  @IsOptional()
  @IsUUID()
  tipoNegocioId?: string;

  @IsUUID()
  listaPrecioId!: string;

  // La columna es `numeric(5,2)`: hasta 999.99, pero un porcentaje de
  // comision no tiene sentido de negocio fuera de 0-100.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'El % de comisión no puede ser negativo.' })
  @Max(100, { message: 'El % de comisión no puede pasar de 100.' })
  pctComision?: number;

  @IsIn(['ninguna', '10+1', '20+1'], {
    message: 'La promoción debe ser "ninguna", "10+1" o "20+1".',
  })
  promocion!: 'ninguna' | '10+1' | '20+1';

  // Siempre presente (puede ser []), no opcional: el formulario manda el
  // estado completo (D4 del spec), igual que `presentaciones` en
  // EditarProductoDto de T-10.
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

  // numeric(9,6): hasta 6 decimales, y el rango geografico real de una
  // latitud/longitud es mas estrecho que lo que la columna permitiria.
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

  // Fecha LOCAL del navegador (D5 del spec), NUNCA algo que el servidor
  // derive -- mismo `@Matches` que `ActualizarPrecioDto` de T-18 en vez de
  // `@IsDateString()`, que aceptaria un datetime ISO completo.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  vigenteDesde!: string;

  // Solo lo manda —y solo se le hace caso a— un usuario General (D6). A un
  // usuario atado se le ignora, no se le responde 403: no intenta salirse de
  // su alcance, su formulario ni siquiera pinta el campo.
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
