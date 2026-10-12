import {
  normalizarDatosRutaAlta,
  type RutaAltaNormalizada,
} from '../rutas/datos-ruta-alta';
import type { RazonRechazoRuta } from '../rutas/ruta-rechazada';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que es del alta de ruta (T-37), en su propio
 * archivo para que `despacho.ts` se quede en un `case` corto por tipo (acuerdo
 * de T-40). Puro, sin base.
 */

export type PreparacionRutaAlta =
  { ok: true; alta: RutaAltaNormalizada } | ({ ok: false } & Rechazo);

/**
 * Valida la FORMA de un alta de ruta antes de abrir la transaccion. Un rechazo
 * aqui no toca la base.
 */
export function prepararRutaAlta(
  op: OperacionNormalizada,
): PreparacionRutaAlta {
  // Un alta de ruta no es una nota que nadie firme. Si trajera folio, ocuparia
  // un numero de la serie de ventas en `sync_operacion.folio` (mismo criterio
  // que el prospecto, T-40).
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'ruta-datos-invalidos',
      motivo: 'folio: un alta de ruta no lleva folio.',
    };
  }

  const r = normalizarDatosRutaAlta(op.datos);
  if (!r.ok) {
    // Codigo propio y no el generico `datos-invalidos`: la tablet distingue un
    // sobre mal armado de un cliente que ya no existe.
    return { ok: false, codigo: 'ruta-datos-invalidos', motivo: r.motivo };
  }

  // El cliente va en `datos` (contrato §6). Una tablet que lo mande tambien en
  // el sobre no se rechaza... salvo que sean dos clientes distintos.
  if (
    op.clienteId !== null &&
    op.clienteId.toLowerCase() !== r.alta.clienteId
  ) {
    return {
      ok: false,
      codigo: 'ruta-datos-invalidos',
      motivo: 'cliente_id: el del sobre y el de datos no coinciden.',
    };
  }

  return { ok: true, alta: r.alta };
}

/**
 * Razon del dominio a codigo del contrato. Un `Record`: si `rutas` agrega una
 * razon, esto deja de compilar hasta asignarle codigo.
 */
export const CODIGO_POR_RAZON_RUTA: Record<RazonRechazoRuta, CodigoRechazo> = {
  'cliente-inexistente': 'cliente-inexistente',
  'ruta-duplicada': 'ruta-duplicada',
};
