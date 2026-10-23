import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * `codigo` NO esta aqui, y esa ausencia es la que aplica D5: con
 * `whitelist: true` en el ValidationPipe global, cualquier `codigo` que venga
 * en el cuerpo se descarta antes de llegar al servicio. No hace falta un
 * chequeo explicito — hace falta NO agregar el campo.
 */
export class EditarSucursalDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  /**
   * T-27 (D7): "Control de inventario en la app". Prendida, los vendedores de la
   * sucursal necesitan aceptar su carga para vender y no venden mas de lo que
   * traen.
   */
  @IsOptional()
  @IsBoolean()
  controlInventario?: boolean;

  /**
   * T-27 pieza 2 (D4): "Consumo propio máximo por día". Piezas que cada vendedor
   * de la sucursal puede registrar como consumo propio en un dia; 0 lo apaga.
   * Mismo rango que el check de la base.
   */
  @IsOptional()
  @IsInt({ message: 'El consumo propio máximo es un número entero.' })
  @Min(0, { message: 'El consumo propio máximo va de 0 a 99.' })
  @Max(99, { message: 'El consumo propio máximo va de 0 a 99.' })
  consumoDiarioMax?: number;
}
