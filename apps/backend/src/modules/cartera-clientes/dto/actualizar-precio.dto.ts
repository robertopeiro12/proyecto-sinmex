import { IsNumber, IsUUID, Matches, Max, Min } from 'class-validator';

export class ActualizarPrecioDto {
  @IsUUID()
  presentacionId!: string;

  @IsUUID()
  listaPrecioId!: string;

  @IsUUID()
  sucursalId!: string;

  // La columna es `numeric(12,2)`: 10 digitos enteros + 2 decimales. Sin este
  // tope, Postgres levanta un 22003 (numeric field overflow) que nadie mapea
  // y el usuario recibe un 500 por un digito de mas (mismo motivo que
  // km_inicial en T-11).
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe ser un número con hasta 2 decimales.' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor que cero.' })
  @Max(9999999999.99, {
    message: 'El precio no puede pasar de 9,999,999,999.99.',
  })
  precio!: number;

  // Fecha LOCAL del navegador (D3 del spec), NUNCA algo que el servidor
  // derive. `@Matches` en vez de `@IsDateString()`: este ultimo acepta
  // datetimes ISO completos, y aqui solo interesa la fecha.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato AAAA-MM-DD.',
  })
  vigenteDesde!: string;
}
