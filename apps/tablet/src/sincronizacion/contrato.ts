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

export type TipoOperacion =
  | 'jornada'
  | 'venta'
  | 'cobranza'
  | 'gasto'
  | 'merma'
  | 'ruta';

export type EstadoOperacion = 'aplicada' | 'duplicada' | 'rechazada';

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
}

export interface PrecioPull extends FilaSincronizable {
  cliente_id: string;
  presentacion_id: string;
  precio_centavos: number;
  vigente_desde: string;
}

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
   * cobranza si lo llevaran (T-16/T-20).
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

export interface ResultadoOperacion {
  clave: string;
  tipo: string;
  estado: EstadoOperacion;
  id_servidor?: string;
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
