import { IsUUID, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /rutas/diaria/notas` y `DELETE /rutas/diaria/notas/:ventaNotaId`. */
export class ConsultaNotasDto {
  @IsUUID(undefined, { message: 'Elige el vendedor.' })
  vendedorId!: string;

  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;
}

/** `PUT /rutas/diaria/notas/:ventaNotaId`: a quien se le asigna y para que dia. */
export class AsignarNotaDto extends ConsultaNotasDto {}

/** El `:ventaNotaId` de la ruta. */
export class NotaParamDto {
  @IsUUID(undefined, { message: 'La nota no es válida.' })
  ventaNotaId!: string;
}
