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
  | 'ruta'
  /** T-40. Un alta de prospecto: el servidor la proyecta a `cliente`. */
  | 'prospecto';

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
  /**
   * T-40: el giro que el vendedor eligio ya no esta en el catalogo del
   * servidor. Se reintenta solo en la siguiente pasada, que ademas le baja el
   * catalogo nuevo — el repositorio deja la fila en la cola, no la descarta.
   */
  'tipo-negocio-inexistente',
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

/**
 * Giro del negocio, para el desplegable de la pantalla de prospectos (T-40).
 *
 * Coleccion **nueva** y por tanto aditiva: no sube la version del contrato. Una
 * tablet vieja la ignora y sigue funcionando.
 *
 * **No cuelga de una sucursal**: `tipo_negocio` es un catalogo de la empresa,
 * igual que `productos`. Y no tiene columna `activo`: su unica baja es
 * `deleted_at`, que viaja como `activo: 0` como todo lo demas.
 *
 * Sin esta coleccion la tablet no tendria de donde sacar la lista y habria que
 * dejar que el vendedor escribiera texto libre — que es exactamente lo que T-12
 * evito al resolver el giro con un catalogo y no con un campo suelto.
 */
export interface TipoNegocioPull extends FilaSincronizable {
  nombre: string;
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
  /**
   * `null` en un prospecto que nacio en la app (T-40).
   *
   * > [!warning] Este campo dejo de ser siempre una cadena, y NO subio la version
   * > Un prospecto que captura el vendedor no trae domicilio: lo sustituye la
   * > ubicacion (`lat`/`lng`). En Postgres la columna se relajo con
   * > `ck_cliente_domicilio_obligatorio`, que lo sigue exigiendo a un `cliente`.
   * >
   * > Estrictamente es un cambio de significado, del que el contrato §3 dice que
   * > sube `CONTRATO_ACTUAL`. Se decidio **no subirla**, y el motivo es que
   * > subirla no protegeria a nadie: `CONTRATO_MINIMO` seguiria en 1, asi que una
   * > tablet vieja se seguiria atendiendo y seguiria recibiendo el `null`. Lo
   * > unico que la protegeria es subir `CONTRATO_MINIMO`, y eso es dejar fuera de
   * > servicio a tablets en la calle por una rotura que **hoy no puede ocurrir**:
   * > la app no se ha publicado nunca (ver [[Sistema de diseno]], "No se ha visto
   * > en una tablet") y las dos mitades salen de este mismo monorepo. Mismo
   * > criterio con el que `folio_segmento` (T-14) y el folio obligatorio de la
   * > venta (T-16) tampoco la subieron.
   * >
   * > **Cuando se publique la primera tablet hay que revisarlo**, y T-43 (version
   * > por fila) es donde toca resolverlo de verdad.
   */
  domicilio: string | null;
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
    /**
     * T-40. **Opcional en la copia de la tablet, obligatoria en el servidor.**
     *
     * No es una divergencia del contrato: es la regla de evolucion §3 aplicada
     * al lado que puede quedarse adelantado. Esta tablet puede hablar con un
     * servidor que todavia no manda la coleccion (el dia del despliegue, entre
     * que sale la app y sale el backend), y leer `undefined` de ahi no puede
     * reventar la sincronizacion — se queda sin desplegable de tipos de negocio
     * y lo dice, nada mas.
     */
    tipos_negocio?: TipoNegocioPull[];
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

/**
 * `datos` de una operacion `tipo: "prospecto"` (T-40).
 *
 * Son los campos que **dicto el cliente** en agosto de 2026 para el alta desde
 * la app (ver [[Cliente]]): nombre del negocio, encargado, telefono, ubicacion,
 * tipo de negocio, comentario y foto del lugar.
 *
 * Lo que NO viaja, y por que:
 *
 * - **`domicilio`**: no se captura. Lo sustituye la ubicacion, y en Postgres la
 *   columna dejo de ser obligatoria para un prospecto.
 * - **`lista_precio_id`, `pct_comision`, `promocion`, `plazo_credito_dias`**: son
 *   decisiones del administrador. El vendedor no puede dar de alta clientes
 *   justamente porque el control del precio no es suyo.
 * - **`cliente_id` y `folio`**, que van en el sobre: un prospecto no tiene
 *   `cliente_id` (lo esta CREANDO) y no lleva folio, porque no es una nota que
 *   nadie firme. El servidor **rechaza** un prospecto que llegue con folio.
 *
 * Es `type` y no `interface` a proposito: la tablet lo asigna a
 * `OperacionSaliente.datos` (`Record<string, unknown>`), y una interface no tiene
 * la firma de indice implicita que eso exige.
 */
export type DatosProspecto = {
  /** Nombre del negocio. Lo unico obligatorio junto al telefono. */
  nombre: string;
  telefono: string;
  /** Nombre del encargado. */
  encargado: string | null;
  /** Del catalogo `tipos_negocio` que baja en el `pull`. */
  tipo_negocio_id: string | null;
  comentarios: string | null;
  /**
   * Ubicacion del dispositivo. **Las dos o ninguna**: media coordenada no ubica
   * nada y en el portal se veria como un punto en el meridiano cero, que es peor
   * que no tener ubicacion porque parece un dato bueno.
   *
   * `null` es un caso **normal**: el vendedor pudo negar el permiso o no haber
   * senal, y eso no le impide registrar al prospecto.
   */
  lat: number | null;
  lng: number | null;
  /**
   * **Reservado y siempre `null` por ahora.**
   *
   * El cliente confirmo que quiere la foto del lugar (2026-08-23), condicionada a
   * que no haga lento el alta. Falta decidir **donde se guarda el archivo** — el
   * candidato es Supabase Storage, y el alcance de Supabase es justo lo que
   * `ADR-0002` dejo abierto. El campo viaja ya, con valor `null`, para que el dia
   * que se decida no haya que cambiar el sobre ni la version del contrato: el
   * servidor lo ignora. **La captura es un ticket aparte.**
   */
  foto: null;
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
  /**
   * Uno de {@link CODIGOS_RECHAZO}, o uno que esta tablet aun no conoce.
   *
   * Sigue siendo `string` y no un tipo cerrado a proposito: un servidor mas
   * nuevo puede mandar un codigo que esta tablet no conoce, y eso no puede
   * reventar la sincronizacion.
   *
   * T-40 agrega `tipo-negocio-inexistente`: el giro que el vendedor eligio ya
   * no esta en el catalogo del servidor. **Se reintenta solo** en la siguiente
   * pasada, que ademas baja el catalogo nuevo — el repositorio deja la fila en
   * la cola, no la descarta.
   */
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
