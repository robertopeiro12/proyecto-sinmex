import {
  normalizarDatosJornada,
  type JornadaNormalizada,
} from '../rutas/datos-jornada';
import type { RazonRechazoJornada } from '../rutas/jornada-rechazada';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es de la jornada (T-38), en su propio archivo
 * para que `despacho.ts` se quede en un `case` corto por tipo (acuerdo de
 * T-40). Puro, sin base.
 */

export type PreparacionJornada =
  { ok: true; jornada: JornadaNormalizada } | ({ ok: false } & Rechazo);

/**
 * Valida la FORMA de una jornada antes de abrir la transaccion. Un rechazo aqui
 * no toca la base.
 *
 * Sin comprobacion de folio ni de `cliente_id`: la tablet no los manda en la
 * jornada (`fuente-jornadas.ts`) y el spec no pide rechazarlos (D2).
 */
export function prepararJornada(op: OperacionNormalizada): PreparacionJornada {
  const r = normalizarDatosJornada(op.datos);
  if (!r.ok) {
    return {
      ok: false,
      // Dos codigos y no el generico `datos-invalidos` (D3): la tablet tiene
      // que poder distinguir un sobre mal armado de un odometro que retrocede.
      codigo:
        r.falla === 'km' ? 'jornada-km-invalido' : 'jornada-datos-invalidos',
      motivo: r.motivo,
    };
  }
  return { ok: true, jornada: r.jornada };
}

/**
 * Razon del dominio a codigo del contrato. Un `Record`: si `rutas` agrega una
 * razon, esto deja de compilar hasta asignarle codigo.
 */
export const CODIGO_POR_RAZON_JORNADA: Record<
  RazonRechazoJornada,
  CodigoRechazo
> = {
  'vehiculo-inexistente': 'vehiculo-inexistente',
  'jornada-duplicada': 'jornada-duplicada',
};
