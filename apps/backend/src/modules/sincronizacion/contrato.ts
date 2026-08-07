/**
 * Contrato de sincronizacion entre la [[App Tablet]] y el servidor (T-07).
 *
 * Este archivo es la **definicion normativa** de lo que viaja por el cable. La
 * version legible para humanos vive en `docs/contrato-sincronizacion.md`; si
 * las dos se contradicen, manda esta.
 *
 * > [!danger] Tablet y servidor se despliegan por separado
 * > Una tablet en la calle puede llevar semanas sin actualizarse mientras el
 * > servidor ya avanzo, y al reves. Por eso el contrato lleva **numero de
 * > version explicito** en cada peticion y en cada respuesta, en vez de confiar
 * > en que ambos lados esten al dia.
 *
 * ## Regla de evolucion
 *
 * - **Cambio aditivo** (campo nuevo opcional, `tipo` de operacion nuevo,
 *   coleccion nueva en el `pull`) → **no** sube la version. Los dos lados deben
 *   ignorar lo que no conocen. Un `tipo` desconocido se rechaza **por
 *   operacion**, no tumba el lote: asi una tablet nueva que ya captura ventas
 *   puede seguir subiendo su jornada contra un servidor viejo.
 * - **Cambio incompatible** (campo obligatorio nuevo, renombrar, cambiar el
 *   significado de un valor) → sube `CONTRATO_ACTUAL` y, si de verdad rompe,
 *   sube tambien `CONTRATO_MINIMO`.
 */

/** Version que habla este servidor. */
export const CONTRATO_ACTUAL = 1;

/**
 * Version mas vieja que este servidor todavia acepta.
 *
 * Existe separada de `CONTRATO_ACTUAL` porque el caso normal es que convivan:
 * subir el contrato no debe dejar fuera de servicio a las tablets que aun no se
 * han actualizado — que es justo el dia en que menos se puede ir a buscarlas.
 */
export const CONTRATO_MINIMO = 1;

/** Numero maximo de operaciones por lote de `push`. */
export const MAX_OPERACIONES_POR_LOTE = 500;

/**
 * Tipos de operacion que la tablet puede empujar.
 *
 * Cada uno corresponde a un modulo de negocio que **todavia no existe**: T-07
 * define solo por donde viajan y las guarda en `sync_operacion` sin
 * interpretarlas. El contenido de `datos` es libre en esta version y lo fijara
 * el ticket de cada modulo.
 *
 * TODO: T-16 — `venta` (cabecera + lineas, ver [[Venta-Nota]]).
 * TODO: T-20 — `cobranza` (abono/liquidacion sobre una nota, ver [[Cobranza-Abono]]).
 * TODO: T-27 — `gasto` (hielo, gasolina, reparacion, adelanto).
 * TODO: T-33 — `merma` (los 3 tipos de merma del documento de julio 2026).
 * TODO: T-39 — `ruta` (visitas, orden real, tiempos y GPS).
 * TODO: T-XX — la jornada (vehiculo + kilometraje inicial/final) no tiene tabla
 *       propia en Postgres todavia; hoy solo se recibe y se guarda.
 */
export const TIPOS_OPERACION = [
  'jornada',
  'venta',
  'cobranza',
  'gasto',
  'merma',
  'ruta',
] as const;

export type TipoOperacion = (typeof TIPOS_OPERACION)[number];

export function esTipoConocido(tipo: string): tipo is TipoOperacion {
  return (TIPOS_OPERACION as readonly string[]).includes(tipo);
}

/** Resultado de una operacion dentro del lote. */
export type EstadoOperacion = 'aplicada' | 'duplicada' | 'rechazada';

/**
 * Motivos de rechazo. Son un enum cerrado a proposito: la tablet tiene que
 * poder decidir **sin leer texto en espanol** si vuelve a intentar (un error
 * transitorio) o si se rinde y avisa al vendedor (un dato mal capturado).
 */
export const CODIGOS_RECHAZO = [
  /** El `tipo` no existe en este servidor (probablemente es mas nuevo). */
  'tipo-desconocido',
  /** `clave` ausente, vacia o demasiado larga. */
  'clave-invalida',
  /** Dos operaciones del MISMO lote traen la misma clave. */
  'clave-repetida-en-el-lote',
  /** `fecha_operacion` no es una fecha `AAAA-MM-DD`. */
  'fecha-invalida',
  /** `fecha_operacion` esta demasiado adelante: el reloj de la tablet miente. */
  'fecha-futura',
  /** `ocurrido_en` no es un instante ISO-8601 valido. */
  'momento-invalido',
  /** `datos` no es un objeto. */
  'datos-invalidos',
  /** El `cliente_id` no existe o no es de la sucursal del vendedor. */
  'cliente-fuera-de-alcance',
] as const;

export type CodigoRechazo = (typeof CODIGOS_RECHAZO)[number];

export interface ResultadoOperacion {
  clave: string;
  tipo: string;
  estado: EstadoOperacion;
  /**
   * Id de la fila de `sync_operacion`. Presente en `aplicada` y en
   * `duplicada` — y en `duplicada` es **el mismo** que devolvio el primer
   * envio. Es lo que hace que reintentar sea seguro: la identidad de la
   * operacion no cambia entre intentos, y cuando T-14 emita el [[Folios|folio]]
   * al proyectar, el reenvio devolvera ese mismo folio en vez de emitir otro.
   */
  id_servidor?: string;
  codigo?: CodigoRechazo;
  motivo?: string;
}

export interface RespuestaPush {
  contrato: number;
  recibido_en: string;
  resumen: {
    recibidas: number;
    aplicadas: number;
    duplicadas: number;
    rechazadas: number;
  };
  resultados: ResultadoOperacion[];
}

/* ------------------------------------------------------------------ */
/* Pull                                                                */
/* ------------------------------------------------------------------ */

/**
 * Las filas del `pull` llevan `activo` en vez de desaparecer.
 *
 * La tablet aplica el snapshot con **upsert, no con reemplazo**
 * ([[ADR-0004 Capa de datos local de la tablet]]): borrar y reinsertar revienta
 * la llave foranea cuando el vendedor ya abrio el dia, que es exactamente el
 * momento del refresco de media manana. Con upsert, una fila que desapareciera
 * del snapshot se quedaria en la tablet para siempre.
 *
 * La salida es que **la baja viaja como bandera**: el portal nunca borra fisico
 * (`deleted_at`), asi que una baja es un `update` y el trigger `set_updated_at`
 * la hace aparecer en el pull incremental como una fila con `activo: 0`. La
 * tablet la refleja y deja de ofrecerla, sin borrar nada que su operacion local
 * todavia referencie. Esto cierra la "politica de purga" que
 * [[Sincronizacion offline]] dejo abierta para este ticket.
 */
export interface FilaSincronizable {
  id: string;
  /** `0` = dada de baja o desactivada en el portal. */
  activo: 0 | 1;
}

export interface SucursalPull extends FilaSincronizable {
  codigo: string;
  nombre: string;
}

export interface VendedorPull extends FilaSincronizable {
  login: string;
  nombre: string;
  sucursal_id: string;
}

export interface VehiculoPull extends FilaSincronizable {
  nombre: string;
  sucursal_id: string;
}

export interface ProductoPull extends FilaSincronizable {
  nombre: string;
}

export interface PresentacionPull extends FilaSincronizable {
  producto_id: string;
  volumen: string;
}

export interface ClientePull extends FilaSincronizable {
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  tipo: 'cliente' | 'prospecto';
  /** Numero puro ("5", no "5%"). Ver [[Cliente]]. */
  pct_comision: number | null;
  promocion: 'ninguna' | '10+1' | '20+1';
  plazo_credito_dias: number | null;
  lat: number | null;
  lng: number | null;
  sucursal_id: string;
}

/**
 * Precio **ya resuelto** para un cliente y una presentacion, en centavos.
 *
 * El portal maneja [[Lista de precios|listas historizadas]] por sucursal mas un
 * override por cliente; la tablet no resuelve nada de eso en campo, recibe el
 * precio que aplica. El `id` es sintetico (`clienteId:presentacionId`) porque
 * la fila de origen puede ser de `precio` (compartida por todos los clientes de
 * esa lista) o de `cliente_precio` (propia), y usar el id de origen provocaria
 * colisiones de llave primaria en la tablet.
 */
export interface PrecioPull extends FilaSincronizable {
  cliente_id: string;
  presentacion_id: string;
  precio_centavos: number;
  vigente_desde: string;
}

/**
 * Nota pendiente por cobrar, para poder seleccionarla al cobrar/abonar sin red.
 *
 * > [!warning] `saldo_centavos` viene de un campo almacenado
 * > Sale del `saldo_pendiente` del ultimo [[Cobranza-Abono|abono]] de la nota, y
 * > del monto total si aun no tiene ninguno. [[Cobranza-Abono]] deja
 * > **pendiente de confirmar** si el saldo debe ser almacenado o derivado
 * > (monto − Σ abonos); T-20 lo cerrara. Aqui se lee lo que hay, no se inventa
 * > un calculo.
 */
export interface NotaPendientePull extends FilaSincronizable {
  folio: string;
  num_nota: string;
  fecha: string;
  cliente_id: string;
  status: 'pendiente' | 'abonado';
  monto_total_centavos: number;
  saldo_centavos: number;
}

export interface RespuestaPull {
  contrato: number;
  /** Reloj del servidor al atender la peticion. */
  servidor_en: string;
  /** Eco de lo que pidio la tablet (`null` = vuelco completo). */
  desde: string | null;
  /** `true` cuando no hubo `desde` y por tanto va todo. */
  completo: boolean;
  /**
   * Lo que la tablet debe mandar como `desde` en el proximo pull.
   *
   * Va **unos segundos por detras** del reloj del servidor a proposito: una
   * transaccion que ya escribio su `updated_at` pero aun no ha hecho commit no
   * seria visible en esta lectura y, con un cursor exacto, se perderia para
   * siempre. Con el retraso vuelve a caer dentro de la siguiente ventana. El
   * solape es inofensivo porque la tablet aplica el snapshot con upsert.
   *
   * TODO: T-43 — el motor de conflictos endurecera esto (version por fila en
   *       vez de marca de tiempo).
   */
  cursor: string;
  vendedor: { id: string; login: string; nombre: string };
  sucursal: { id: string; codigo: string; nombre: string };
  catalogos: {
    sucursales: SucursalPull[];
    vendedores: VendedorPull[];
    vehiculos: VehiculoPull[];
    productos: ProductoPull[];
    presentaciones: PresentacionPull[];
    clientes: ClientePull[];
    /**
     * **Siempre completo o vacio**, nunca parcial. El precio efectivo depende
     * de tres tablas (`precio`, `cliente_precio` y la lista asignada al
     * cliente), asi que un cursor por fila sobre el resultado del join se
     * perderia cambios. Se manda todo si alguna de las tres se movio desde
     * `desde`, y nada si ninguna lo hizo.
     */
    precios: PrecioPull[];
  };
  notas_pendientes: NotaPendientePull[];
}
