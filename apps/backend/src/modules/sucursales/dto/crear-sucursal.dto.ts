import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Quita espacios sobrantes sin reventar si llega algo que no es cadena. */
const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CrearSucursalDto {
  // Se normaliza ANTES de validar (@Transform corre primero) para que 'tj'
  // pase y se guarde como 'TJ'. La base solo acepta mayusculas
  // (sucursal_codigo_formato); esto evita un 400 por algo que no le importa a
  // nadie y que ademas terminaria en un 500 si llegara hasta el insert.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'El código de sucursal debe ser exactamente 2 letras.',
  })
  codigo!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  // La columna es `text` (sin limite). El tope vive aqui porque un campo de
  // texto sin cota es una invitacion a meter un documento entero en un
  // catalogo que se pinta en una tabla.
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;
}
