import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MAX_OPERACIONES_POR_LOTE } from '../contrato';

/**
 * `GET /sync/pull`.
 *
 * Los tres parametros llegan como texto en la query; `transform: true` del
 * ValidationPipe global los convierte con los `@Type` de aqui.
 */
export class PullDto {
  /** Version del contrato que habla la tablet. Ver `contrato.ts`. */
  @Type(() => Number)
  @IsInt({ message: 'El contrato debe ser un entero.' })
  contrato!: number;

  /**
   * Cursor del pull incremental: el `cursor` que devolvio el pull anterior.
   * Ausente = vuelco completo (primer arranque de la tablet, o reinstalacion).
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  desde?: string;

  /**
   * Sucursal que **propone** el cliente. La decide el servidor con
   * `resolverAlcance()`: pedir una ajena responde 403. Ver T-09.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sucursal?: string;
}

/**
 * `POST /sync/push`.
 *
 * > [!important] `operaciones` NO se valida con una clase anidada
 * > Es deliberado. Con `@ValidateNested`, una sola operacion mal formada
 * > devolveria **400 para todo el lote** y el vendedor perderia el dia entero
 * > por un campo. El criterio de aceptacion del ticket pide lo contrario: decir
 * > **cuales** entraron y cuales no. Asi que aqui solo se comprueba la
 * > envoltura, y cada operacion pasa por `normalizarOperacion()`, que devuelve
 * > un motivo por operacion en vez de tumbar la peticion.
 */
export class PushDto {
  @Type(() => Number)
  @IsInt({ message: 'El contrato debe ser un entero.' })
  contrato!: number;

  /** Identificador libre de la tablet. Solo para diagnostico. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  dispositivo?: string;

  /**
   * Sucursal que **propone** el cliente, igual que en el pull. Manda el
   * servidor: el alcance vale igual en escritura que en lectura (T-09, D3).
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sucursal?: string;

  @IsArray({ message: 'operaciones debe ser una lista.' })
  @ArrayNotEmpty({ message: 'El lote no puede ir vacio.' })
  @ArrayMaxSize(MAX_OPERACIONES_POR_LOTE, {
    message: `Un lote no puede traer mas de ${MAX_OPERACIONES_POR_LOTE} operaciones.`,
  })
  operaciones!: unknown[];
}
