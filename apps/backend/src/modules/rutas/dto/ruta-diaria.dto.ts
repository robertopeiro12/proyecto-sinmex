import { ArrayMaxSize, IsArray, IsUUID, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tope de clientes por ruta. Una ruta tiene decenas; el tope es para que un
 * cuerpo absurdo sea 400 y no una transaccion de miles de `update`.
 */
export const MAX_CLIENTES_RUTA = 300;

/** `GET /rutas/diaria` y `GET /rutas/diaria/anterior` (T-37, D14). */
export class ConsultaRutaDiariaDto {
  @IsUUID(undefined, { message: 'Elige el vendedor.' })
  vendedorId!: string;

  @Matches(RE_FECHA, { message: 'La fecha debe tener el formato AAAA-MM-DD.' })
  fecha!: string;
}

/**
 * `PUT /rutas/diaria`: la lista COMPLETA y ordenada de la ruta (semantica de
 * reemplazo, D14). Vacia es valida: quita lo de la oficina.
 */
export class GuardarRutaDiariaDto extends ConsultaRutaDiariaDto {
  @IsArray({ message: 'La ruta debe ser una lista de clientes.' })
  @ArrayMaxSize(MAX_CLIENTES_RUTA, {
    message: `Una ruta no puede pasar de ${MAX_CLIENTES_RUTA} clientes.`,
  })
  @IsUUID(undefined, {
    each: true,
    message: 'Uno de los clientes no es válido.',
  })
  clientes!: string[];
}
