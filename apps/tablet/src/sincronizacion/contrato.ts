/**
 * El contrato de sincronizacion, visto desde la tablet (T-07).
 *
 * > [!warning] Esto es una copia deliberada, no un descuido
 * > La definicion normativa vive en
 * > `apps/backend/src/modules/sincronizacion/contrato.ts`, y la version legible
 * > en `docs/contrato-sincronizacion.md`. Aqui se repite porque **la tablet no
 * > puede importar del backend**: Metro empaqueta este workspace y arrastrar
 * > codigo de NestJS reventaria el bundle. Un paquete compartido resolveria la
 * > duplicacion, pero anadiria un cuarto workspace y una capa de build a un
 * > monorepo que hoy no la tiene — no compensa por ~150 lineas de tipos.
 * >
 * > Lo que si compensa, y es la razon de que el contrato lleve version: **los
 * > dos lados se despliegan por separado**. Si esta copia se queda atras, el
 * > servidor responde 409 diciendolo, en vez de fallar de forma rara.
 *
 * Si tocas este archivo, toca el del backend y el `docs/` en el mismo commit.
 */

/** Version que habla esta tablet. Debe coincidir con la del backend. */
export const CONTRATO_ACTUAL = 1;

/** Maximo de operaciones por lote. Pasarse es un 400 del servidor. */
export const MAX_OPERACIONES_POR_LOTE = 500;

/**
 * Tamano maximo de un lote de `push`, en bytes del JSON de sus operaciones
 * (UTF-8).
 *
 * La tablet cierra el lote cuando la siguiente operacion lo haria pasar de este
 * tamano o de {@link MAX_OPERACIONES_POR_LOTE} operaciones, **lo que ocurra
 * primero**. El tope por cantidad no basta: 500 ventas pesan 218-754 kB segun
 * cuantas lineas traiga cada una.
 *
 * Se mide la suma del JSON de cada operacion, no el cuerpo entero del envio
 * (que suma ademas `{"contrato":1,"operaciones":[...]}` y las comas). Por eso
 * el servidor acepta hasta **5 MB**: cinco veces este tope, holgura suficiente
 * para el sobre y para una operacion suelta mas grande que el tope, que viaja
 * sola en su lote en vez de descartarse.
 */
export const MAX_BYTES_POR_LOTE = 1_000_000;

export type TipoOperacion =
  | 'jornada'
  | 'venta'
  | 'cobranza'
  | 'gasto'
  | 'merma'
  | 'ruta';

export type EstadoOperacion = 'aplicada' | 'duplicada' | 'rechazada';

/**
 * Motivos de rechazo que conoce esta tablet. Copia del enum del backend.
 *
 * `ResultadoOperacion.codigo` sigue siendo `string` y no este tipo a proposito:
 * un servidor mas nuevo puede mandar un codigo que esta tablet no conoce, y eso
 * no puede reventar la sincronizacion.
 */
export const CODIGOS_RECHAZO = [
  'tipo-desconocido',
  'clave-invalida',
  'clave-repetida-en-el-lote',
  'fecha-invalida',
  'fecha-futura',
  'momento-invalido',
  'datos-invalidos',
  'cliente-fuera-de-alcance',
  'folio-invalido',
  'folio-duplicado',
  /** T-16: la presentacion no se vende. Se reintenta en la siguiente sincronizacion. */
  'presentacion-inactiva',
  /**
   * T-16: el cliente no tiene precio para esa presentacion (a la fecha ni
   * despues, hasta hoy). Lo arregla el portal.
   */
  'precio-no-asignado',
  /** T-20: la nota cobrada no existe en el servidor o no es de este cliente. Se reenvia. */
  'nota-no-encontrada',
] as const;

export type CodigoRechazo = (typeof CODIGOS_RECHAZO)[number];

/** Fila de catalogo: la baja llega como `activo: 0`, nunca como ausencia. */
interface FilaSincronizable {
  id: string;
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
  /**
   * Las 2 letras del vendedor dentro del [[Folios|folio]] (5o segmento). T-14.
   *
   * **Lo asigna el servidor y la tablet lo usa tal cual.** No lo deriva ella de
   * `nombre` aunque podria: dos vendedores con las mismas iniciales chocarian,
   * y la tablet **no puede detectarlo** porque de `vendedores` solo baja su
   * propia ficha — no ve a sus companeros.
   *
   * `null` = todavia sin asignar. Sin segmento **no se puede emitir folio**, y
   * el repositorio lo dice en voz alta (`ErrorFolio`) en vez de inventarse las
   * iniciales: eso reintroduciria en silencio la ambiguedad que sigue
   * pendiente de confirmar con el cliente (ADR-0007).
   *
   * Campo **aditivo**: no sube la version del contrato.
   */
  folio_segmento: string | null;
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
  pct_comision: number | null;
  promocion: 'ninguna' | '10+1' | '20+1';
  plazo_credito_dias: number | null;
  lat: number | null;
  lng: number | null;
  sucursal_id: string;
  /** T-20: suma de los movimientos vivos de saldo a favor, en centavos. Solo se muestra. */
  saldo_favor_centavos: number;
}

export interface PrecioPull extends FilaSincronizable {
  cliente_id: string;
  presentacion_id: string;
  precio_centavos: number;
  vigente_desde: string;
}

/** Un abono vivo de una nota (T-20). */
export interface AbonoPull {
  fecha_pago: string;
  monto_centavos: number;
  metodo_pago: MetodoPago;
}

/**
 * Nota por cobrar. T-20: `saldo_centavos` es derivado (monto − Σ abonos vivos);
 * con `desde` bajan tambien las notas cerradas con `activo: 0`, y su `status`
 * sigue siendo `pendiente`/`abonado` para no romper el CHECK local.
 */
export interface NotaPendientePull extends FilaSincronizable {
  folio: string;
  num_nota: string;
  fecha: string;
  cliente_id: string;
  status: 'pendiente' | 'abonado';
  monto_total_centavos: number;
  saldo_centavos: number;
  abonos: AbonoPull[];
}

export interface RespuestaPull {
  contrato: number;
  servidor_en: string;
  desde: string | null;
  completo: boolean;
  /** Lo que hay que mandar como `desde` en el proximo pull. */
  cursor: string;
  vendedor: {
    id: string;
    login: string;
    nombre: string;
    /** Su segmento del folio. Ver {@link VendedorPull.folio_segmento}. */
    folio_segmento: string | null;
  };
  sucursal: { id: string; codigo: string; nombre: string };
  catalogos: {
    sucursales: SucursalPull[];
    vendedores: VendedorPull[];
    vehiculos: VehiculoPull[];
    productos: ProductoPull[];
    presentaciones: PresentacionPull[];
    clientes: ClientePull[];
    precios: PrecioPull[];
  };
  notas_pendientes: NotaPendientePull[];
}

/**
 * Una operacion capturada offline, lista para subir.
 *
 * `clave` es **el id local de la fila en SQLite** (uuid v4 generado al
 * capturar). No cambia nunca, ni entre reintentos ni entre versiones de la app:
 * es lo que hace que reenviar un lote no duplique nada.
 *
 * `fecha_operacion` es el **dia de trabajo** calculado con el reloj local de la
 * tablet (`reloj.hoy()`), no derivado de `ocurrido_en`: a las 18:00 de Tijuana
 * en UTC ya es el dia siguiente.
 */
export interface OperacionSaliente {
  clave: string;
  tipo: TipoOperacion;
  fecha_operacion: string;
  ocurrido_en: string;
  cliente_id?: string;
  /**
   * El [[Folios|folio]] que la tablet emitio **offline** para esta operacion
   * (T-14), o ausente si su tipo no lleva folio.
   *
   * Hoy la `jornada` no lo lleva: no es una nota que nadie firme. Venta y
   * cobranza si lo llevan, y en ellas es obligatorio (T-16/T-20).
   *
   * > [!danger] El folio NO es la clave de idempotencia
   * > Son capas distintas y hay que mantenerlas separadas (ADR-0006). `clave`
   * > identifica el **transporte** y no cambia entre reintentos; el folio
   * > identifica el **hecho de negocio** y solo se emite una vez. El servidor
   * > lo defiende con un unique propio y rechaza las colisiones con
   * > `folio-duplicado`.
   */
  folio?: string;
  datos: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Forma de `datos` por tipo                                           */
/* ------------------------------------------------------------------ */

/**
 * Una linea de una venta (T-16).
 *
 * `precio_centavos` va **siempre**: es el precio de la nota que firmo el
 * cliente, el que bajo en el ultimo `pull`, y el servidor lo guarda sin
 * compararlo con su catalogo (vale el de la nota firmada). Entero >= 0; solo
 * puede ser 0 en una linea de pura promocion (`cantidad` 0).
 */
export type LineaVenta = {
  presentacion_id: string;
  cantidad: number;
  cantidad_promocion: number;
  precio_centavos: number;
};

/**
 * `datos` de una operacion `tipo: "venta"` (T-16).
 *
 * `cliente_id` y `folio` viajan en el **sobre**, no aqui, y en una venta son
 * obligatorios. No lleva monto ni status: los calcula el servidor (el monto
 * como suma de cantidad x precio, sin las piezas de promocion).
 *
 * Es `type` y no `interface` a proposito: la tablet lo asigna a
 * `OperacionSaliente.datos` (`Record<string, unknown>`), y una interface no
 * tiene la firma de indice implicita que eso exige.
 */
export type DatosVenta = {
  num_nota: string;
  contado_credito: 'contado' | 'credito';
  factura: 'N/A' | 'pendiente';
  comentarios: string | null;
  /** De 1 a 50, sin presentacion repetida. */
  lineas: LineaVenta[];
};

/** Catalogo de metodos de pago. En la app el default es `efectivo`. */
export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

/**
 * `datos` de una operacion `tipo: "cobranza"` (T-20).
 *
 * Un pago sobre UNA nota; el servidor reparte el excedente a las otras notas
 * del cliente y al saldo a favor. `cliente_id` y `folio` van en el sobre y son
 * obligatorios.
 */
export type DatosCobranza = {
  venta_nota_id: string;
  /** Entero, de 1 a 999_999_999_999. */
  monto_centavos: number;
  metodo_pago: MetodoPago;
  /** `AAAA-MM-DD`, no posterior a `fecha_operacion`. */
  fecha_pago: string;
};

export interface ResultadoOperacion {
  clave: string;
  tipo: string;
  estado: EstadoOperacion;
  id_servidor?: string;
  /** Uno de {@link CODIGOS_RECHAZO}, o uno que esta tablet aun no conoce. */
  codigo?: string;
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
