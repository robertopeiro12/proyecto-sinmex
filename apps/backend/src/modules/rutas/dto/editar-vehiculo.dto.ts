import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Los tres campos son opcionales: el servicio rechaza con 400 el cuerpo que no
 * traiga ninguno.
 *
 * SIN `sucursalId` a proposito (D3): la sucursal de un vehiculo no se cambia.
 * Mover uno de sucursal cambiaria a que alcance pertenecen sus registros
 * historicos de kilometraje. Si el negocio de verdad reasigna vehiculos, es un
 * ticket propio con su propia regla para el historico.
 */
export class EditarVehiculoDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del vehículo es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El kilometraje debe ser un número con hasta 2 decimales.' },
  )
  @Min(0, { message: 'El kilometraje no puede ser negativo.' })
  kmInicial?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
