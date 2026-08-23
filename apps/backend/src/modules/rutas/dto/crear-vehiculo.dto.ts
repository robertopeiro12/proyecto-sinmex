import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Quita espacios sobrantes sin reventar si llega algo que no es cadena. */
const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearVehiculoDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre del vehículo es obligatorio.' })
  // La columna es `text` (sin limite). El tope vive aqui porque un campo de
  // texto sin cota es una invitacion a meter un documento entero en un catalogo
  // que se pinta en una tabla. Mismo tope que sucursal y producto.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;

  // La columna es `numeric(10,2)` y NULLABLE en la base, pero el alta lo exige:
  // un vehiculo sin km de partida deja el reporte de kilometraje sin origen. No
  // se cambia la columna a `not null` por un campo que la API ya obliga (ver el
  // spec, seccion Modelo de datos).
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El kilometraje debe ser un número con hasta 2 decimales.' },
  )
  @Min(0, { message: 'El kilometraje no puede ser negativo.' })
  // numeric(10,2) tope en 99999999.99: sin esta cota, Postgres levanta un
  // 22003 (numeric field overflow) que nadie mapea y el usuario recibe un 500
  // por un digito de mas.
  @Max(99999999.99, {
    message: 'El kilometraje no puede pasar de 99,999,999.99.',
  })
  kmInicial!: number;

  // Opcional a proposito (D3): solo lo manda —y solo se le hace caso a— un
  // usuario General. A un usuario atado a una sucursal se le IGNORA, no se le
  // responde 403: no esta intentando salirse de su alcance, esta mandando un
  // campo que su formulario ni siquiera pinta.
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
