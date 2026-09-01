import { IsNumber, IsUUID, Max, Min, ValidateIf } from 'class-validator';

/**
 * `precio: null` significa "usa el precio de lista, sin override" (D5 del
 * spec) -- Sin `@IsOptional()` a proposito: eso tambien aceptaria
 * `undefined`, y el campo SIEMPRE tiene que venir explicito (numero o
 * null), nunca faltar. `@ValidateIf` deja pasar `null` sin correr los
 * validadores numericos, pero si el valor es `undefined` la condicion sigue
 * siendo verdadera y `@IsNumber` lo rechaza -- es la combinacion que exige
 * "numero o null, nunca ausente".
 */
export class OverridePrecioDto {
  @IsUUID()
  presentacionId!: string;

  @ValidateIf((o: OverridePrecioDto) => o.precio !== null)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe ser un número con hasta 2 decimales.' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor que cero.' })
  // Mismo tope que `precio.dto` de T-18: la columna es `numeric(12,2)`.
  @Max(9999999999.99, {
    message: 'El precio no puede pasar de 9,999,999,999.99.',
  })
  precio!: number | null;
}
