import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { CONDICIONES_VENTA, type CondicionVenta } from '../reglas-notas-ruta';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /rutas/diaria/notas` y `DELETE /rutas/diaria/notas/:ventaNotaId`. */
export class ConsultaNotasDto {
  @IsUUID(undefined, { message: 'Elige el vendedor.' })
  vendedorId!: string;

  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;
}

/** `PUT /rutas/diaria/notas/:ventaNotaId`: a quien se le asigna y para que dia. */
export class AsignarNotaDto extends ConsultaNotasDto {
  /** Lo que se le pide al vendedor; sin ella, `ninguna`. */
  @IsOptional()
  @IsIn(CONDICIONES_VENTA, { message: 'La condición de venta no es válida.' })
  condicionVenta?: CondicionVenta;
}

/** El `:ventaNotaId` de la ruta. */
export class NotaParamDto {
  @IsUUID(undefined, { message: 'La nota no es válida.' })
  ventaNotaId!: string;
}
