import {
  normalizarDatosProspecto,
  type ProspectoNormalizado,
} from '../cartera-clientes/datos-prospecto';
import type { RazonRechazoProspecto } from '../cartera-clientes/prospecto-rechazado';
import type { CodigoRechazo } from './contrato';
import type { OperacionNormalizada, Rechazo } from './operaciones';

/**
 * La parte del despachador que corresponde al `tipo: 'prospecto'` (T-40).
 *
 * Vive en su propio archivo y no dentro de `despacho.ts` por una razon
 * practica: `despacho.ts` lo creo T-16 y lo va a seguir tocando cada ticket que
 * sume un tipo. Con cada tipo en su archivo, `despacho.ts` se queda en un `case`
 * de dos lineas por tipo y los conflictos de rebase entre ramas apiladas
 * (T-20, T-31, T-38, T-39...) se reducen a esas dos lineas.
 *
 * Puro, sin base de datos: decide si la operacion tiene la FORMA correcta. Lo
 * que hay que consultar (que el tipo de negocio exista) lo decide
 * `ClientesService.crearProspecto` dentro de la transaccion.
 */

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PreparacionProspecto =
  { ok: true; prospecto: ProspectoNormalizado } | ({ ok: false } & Rechazo);

export function prepararProspecto(
  op: OperacionNormalizada,
): PreparacionProspecto {
  /**
   * Un prospecto **no lleva folio**, y esto es el espejo de la regla de la
   * venta (que sin folio se rechaza).
   *
   * No es cosmetico: `sync_operacion.folio` tiene un `unique` **global**, asi
   * que un folio que llegara pegado a un prospecto consumiria un numero del
   * espacio de folios de las ventas y una venta legitima con ese mismo numero
   * se rechazaria despues como `folio-duplicado` — un fallo que aparece en otra
   * operacion, dias despues, y que nadie relacionaria con esto. Ademas el
   * contador de la tablet reinicia por dia y vendedor (ADR-0001): un folio
   * gastado en un prospecto es un hueco en la numeracion de las notas fisicas.
   */
  if (op.folio !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'folio: un prospecto no lleva folio; no es una nota que el cliente firme.',
    };
  }

  /**
   * Y tampoco lleva `cliente_id`: el prospecto **es** el cliente que se esta
   * creando. Si viniera uno, la operacion esta mal armada — y el `push` ya
   * habria comprobado su alcance contra la sucursal, lo que hace aun mas
   * confuso dejarlo pasar en silencio.
   */
  if (op.clienteId !== null) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'cliente_id: un prospecto no se refiere a un cliente, lo esta creando.',
    };
  }

  /**
   * T-75 (D2): la clave **es** el id del cliente que se va a crear. La tablet
   * registro el prospecto localmente con ese id y puede tener ya una venta
   * encolada que apunta a el; si el servidor inventara otro id, esa venta
   * nunca encontraria a su cliente. `cliente.id` es `uuid`, asi que la clave
   * tiene que serlo: una que no lo sea es un bug de la tablet (la app siempre
   * manda `randomUUID()`), no un catalogo viejo — `datos-invalidos`.
   */
  if (!RE_UUID.test(op.clave)) {
    return {
      ok: false,
      codigo: 'datos-invalidos',
      motivo:
        'clave: la clave de un prospecto debe ser un uuid; es el id con el que la tablet ya lo registró.',
    };
  }

  const r = normalizarDatosProspecto(op.datos);
  if (!r.ok) {
    return { ok: false, codigo: 'datos-invalidos', motivo: r.motivo };
  }
  return { ok: true, prospecto: r.prospecto };
}

/**
 * Razon del dominio a codigo del contrato, para el prospecto.
 *
 * Un `Record` y no un `switch`, igual que `CODIGO_POR_RAZON` de la venta: si
 * `cartera-clientes` agrega una razon de rechazo, esto deja de compilar hasta
 * que alguien le asigne su codigo. Un generico `proyeccion-fallida` no vale
 * (ADR-0009 §2.3): la tablet tiene que poder decirle al vendedor **que**
 * corregir sin leer texto en espanol.
 */
export const CODIGO_POR_RAZON_PROSPECTO: Record<
  RazonRechazoProspecto,
  CodigoRechazo
> = {
  'tipo-negocio-inexistente': 'tipo-negocio-inexistente',
  'id-ocupado': 'datos-invalidos',
};

/**
 * ¿El servidor intenta geocodificar este alta despues del commit? (T-72, D5)
 *
 * Solo con direccion y sin GPS: con coordenada del GPS no hay nada que
 * calcular, y sin direccion no hay con que.
 */
export function pideGeocodificacion(prospecto: ProspectoNormalizado): boolean {
  return prospecto.domicilio !== null && prospecto.lat === null;
}
