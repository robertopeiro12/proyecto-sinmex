import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tope de clientes por ruta. Una ruta tiene decenas; el tope es para que un
 * cuerpo absurdo sea 400 y no una transaccion de miles de `update`.
 */
export const MAX_CLIENTES_RUTA = 300;

/** Tope del recado de la oficina para el vendedor (el check de `ruta.recado`). */
export const MAX_RECADO = 200;

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Una fecha `AAAA-MM-DD`. */
class ConFechaDto {
  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;
}

/** `GET /rutas/diaria`, `GET /rutas/diaria/opciones` y `DELETE /rutas/diaria`. */
export class ConsultaRutaDiariaDto extends ConFechaDto {
  @IsUUID(undefined, { message: 'Elige el vendedor.' })
  vendedorId!: string;
}

/** `GET /rutas/diaria/dia?fecha&sucursal`. Sin sucursal = la del usuario o "Todas". */
export class ConsultaDiaDto extends ConFechaDto {
  @IsOptional()
  @IsString()
  sucursal?: string;
}

/** Un cliente de la ruta del dia, con el recado que vera el vendedor (recortado; vacio = sin recado). */
export class ClienteRutaDiariaDto {
  @IsUUID(undefined, { message: 'Uno de los clientes no es válido.' })
  clienteId!: string;

  @IsOptional()
  @Transform(recortar)
  @IsString({ message: 'El recado debe ser texto.' })
  @MaxLength(MAX_RECADO, {
    message: `El recado no puede pasar de ${MAX_RECADO} caracteres.`,
  })
  recado?: string | null;
}

/**
 * `PUT /rutas/diaria`: la ruta COMPLETA de ese vendedor y dia: la ruta semanal
 * (o ninguna), el vehiculo (o ninguno) y la lista ordenada de clientes con su
 * recado (semantica de reemplazo, D14). Lista vacia es valida: quita lo de la
 * oficina.
 */
export class GuardarRutaDiariaDto extends ConsultaRutaDiariaDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'La ruta no es válida.' })
  rutaSemanalId?: string | null;

  @IsOptional()
  @IsUUID(undefined, { message: 'El vehículo no es válido.' })
  vehiculoId?: string | null;

  @IsArray({ message: 'La ruta debe ser una lista de clientes.' })
  @ArrayMaxSize(MAX_CLIENTES_RUTA, {
    message: `Una ruta no puede pasar de ${MAX_CLIENTES_RUTA} clientes.`,
  })
  @ValidateNested({ each: true })
  @Type(() => ClienteRutaDiariaDto)
  clientes!: ClienteRutaDiariaDto[];
}
