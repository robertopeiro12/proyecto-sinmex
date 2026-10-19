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
  | 'prospecto'
  /** T-37. Un cliente que el vendedor agrego a su ruta del dia. */
  | 'ruta-alta'
  /** T-39. Una visita sin venta: el servidor la proyecta a `visita` con id = clave. */
  | 'visita';

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
  /**
   * T-20: la nota cobrada no existe en el servidor, es de otra sucursal o no es
   * de este cliente. Se reenvia.
   */
  'nota-no-encontrada',
  /** T-38: `datos` de la jornada no tiene la forma de {@link DatosJornada}. Bug de la tablet. */
  'jornada-datos-invalidos',
  /** T-38: `km_final` menor que `km_inicial`. */
  'jornada-km-invalido',
  /**
   * T-38: el vehiculo no existe en el servidor, esta dado de baja o es de otra
   * sucursal. Se reenvia en cada sincronizacion: el portal puede corregirlo.
   */
  'vehiculo-inexistente',
  /**
   * T-38: el servidor ya tiene una jornada de este vendedor ese dia, con otra
   * clave. Se queda en `error` con el motivo; no se resuelve sola.
   */
  'jornada-duplicada',
  /**
   * T-37: `datos.cliente_id` del alta de ruta falta o no es uuid, el sobre trae
   * folio, o trae un `cliente_id` que no coincide con el de `datos`. Bug de la
   * tablet.
   */
  'ruta-datos-invalidos',
  /**
   * T-37: el cliente del alta no existe en el servidor, esta dado de baja, es de
   * otra sucursal o es un prospecto. La fila queda en `error`; el vendedor la
   * puede quitar.
   */
  'cliente-inexistente',
  /**
   * T-37: la oficina ya tenia a ese cliente en la ruta de ese dia. **No es un
   * error**: `fuente-rutas.ts` la marca como sincronizada y el pull posterior la
   * funde con la fila del servidor.
   */
  'ruta-duplicada',
  /**
   * T-39: el motivo de la visita no existe en el servidor (un id que nunca
   * existio; uno dado de baja se acepta). La visita queda en `error` y se
   * reintenta.
   */
  'motivo-visita-inexistente',
  /** T-39: el id de la visita ya lo ocupa otro registro. Motivo neutro. */
  'visita-id-ocupado',
  /**
   * T-30/T-31: el campo del gasto no existe en el servidor (un id que nunca
   * existio; uno dado de baja se acepta). El gasto queda en `error`.
   */
  'campo-egreso-inexistente',
  /** T-30/T-31: el id del gasto ya lo ocupa otro registro. Motivo neutro. */
  'gasto-id-ocupado',
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

/** Copia del backend (T-39). */
export interface MotivoVisitaPull extends FilaSincronizable {
  nombre: string;
  exige_foto: boolean;
  exige_atendio: boolean;
}

/** Copia del backend (T-30). */
export interface CampoEgresoPull extends FilaSincronizable {
  nombre: string;
  tipo: 'produccion' | 'operacion' | 'financiero';
  se_usa_en_app: boolean;
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
  /**
   * T-74 (D14): cuando el servidor proyecto la primera nota viva de este
   * cliente (ISO), o `null` si nunca le han vendido. La tablet lo usa para la
   * promocion de prospecto, que solo aplica en su primera venta.
   *
   * > `promocion` ('ninguna' | '10+1' | '20+1') se QUITO aqui sin subir el
   * > contrato (D17): mismo criterio que `domicilio` arriba. Las promociones
   * > ahora bajan en la coleccion `promociones` (T-74).
   */
  primera_venta_en: string | null;
  plazo_credito_dias: number | null;
  lat: number | null;
  lng: number | null;
  /**
   * T-72 (D3). **Opcional en la copia de la tablet**: un servidor anterior no lo
   * manda (`aSnapshot` lo vuelve `null`). Se guarda; aun no se muestra.
   */
  ubicacion_origen?: 'gps' | 'geocodificada' | 'manual' | null;
  sucursal_id: string;
  /** T-20: suma de los movimientos vivos de saldo a favor, en centavos. Solo se muestra. */
  saldo_favor_centavos: number;
  /**
   * T-39. **Opcional en la copia de la tablet**: un servidor anterior no lo
   * manda (`aSnapshot` lo vuelve `null`).
   */
  foto_subida_en?: string | null;
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
  metodo_pago: MetodoPagoAbono;
}

/**
 * Nota por cobrar. T-20: `saldo_centavos` es derivado (monto − Σ abonos vivos);
 * con `desde` bajan tambien las notas cerradas con `activo: 0`, y su `status`
 * sigue siendo `pendiente`/`abonado` para no romper el CHECK local.
 */
export interface NotaPendientePull extends FilaSincronizable {
  folio: string;
  /** `null` si la venta no tuvo nota de papel (lo normal). */
  num_nota: string | null;
  fecha: string;
  cliente_id: string;
  status: 'pendiente' | 'abonado';
  monto_total_centavos: number;
  saldo_centavos: number;
  abonos: AbonoPull[];
}

/**
 * Una fila de la ruta diaria del vendedor (T-37). Copia de la del backend.
 *
 * Ventana por el reloj del servidor: desde ayer en adelante, sin tope: una ruta
 * futura debe bajar en el pull siguiente a su creacion. La tablet decide que
 * dia mostrar con su reloj local.
 */
export interface RutaPull extends FilaSincronizable {
  cliente_id: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  orden: number;
  origen: 'oficina' | 'vendedor';
}

/* ------------------------------------------------------------------ */
/* T-74: promociones por regla                                         */
/* ------------------------------------------------------------------ */

export type AudienciaPromocion = 'todos' | 'cliente' | 'prospecto';
export type CompraPromocion = 'cualquiera' | 'producto' | 'presentacion';
export type RegaloPromocion = 'mismo' | 'producto' | 'presentacion';

/**
 * Una regla de promocion (T-74, D1): por la compra de `compra_cantidad` piezas
 * del objetivo de `compra_*` se regalan `regalo_cantidad` piezas del objetivo
 * de `regalo_*`. La regla de APLICACION vive en la tablet
 * (`src/datos/promociones-reglas.ts`); el servidor solo la transporta.
 *
 * - `audiencia`: `todos` (los clientes de la sucursal), `cliente` (uno:
 *   `cliente_id`) o `prospecto` (solo en la primera venta del prospecto, D7).
 * - `compra_cantidad` puede ser 0 solo con `prospecto` (regalo sin compra).
 * - `regalo_tipo = 'mismo'` nunca viene con `compra_tipo = 'cualquiera'`.
 * - `activo: 0` = desactivada o dada de baja: la tablet la conserva (una venta
 *   local puede referenciarla) pero no la aplica.
 */
export interface PromocionPull extends FilaSincronizable {
  audiencia: AudienciaPromocion;
  cliente_id: string | null;
  compra_tipo: CompraPromocion;
  compra_producto_id: string | null;
  compra_presentacion_id: string | null;
  compra_cantidad: number;
  regalo_tipo: RegaloPromocion;
  regalo_producto_id: string | null;
  regalo_presentacion_id: string | null;
  regalo_cantidad: number;
  se_repite: boolean;
}

/**
 * Un regalo de una venta (T-74, D12): que promocion dio cuantas piezas de que
 * presentacion. `texto` es la frase de la promocion tal como la vio el
 * vendedor; el servidor la congela en la nota aunque la oficina edite la
 * promocion despues.
 */
export type RegaloVenta = {
  promocion_id: string;
  presentacion_id: string;
  cantidad: number;
  texto: string;
};

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
    /**
     * T-39. **Opcional en la copia de la tablet, obligatoria en el servidor**,
     * por la misma razon que `tipos_negocio`: sin la coleccion la pantalla de
     * visita dice que no hay catalogo y no deja guardar.
     */
    motivos_visita?: MotivoVisitaPull[];
    /**
     * T-30. **Opcional en la copia de la tablet, obligatoria en el servidor**,
     * por la misma razon que `tipos_negocio`: sin la coleccion la pantalla de
     * gastos dice que no hay catalogo y no deja registrar.
     */
    campos_egreso?: CampoEgresoPull[];
    precios: PrecioPull[];
  };
  notas_pendientes: NotaPendientePull[];
  /**
   * T-37. **Opcional en la copia de la tablet, obligatoria en el servidor**, por
   * la misma razon que `catalogos.tipos_negocio`: esta tablet puede hablar con
   * un servidor que todavia no la manda, y leer `undefined` no puede reventar la
   * sincronizacion. Sin la coleccion, la tablet funciona sin ruta asignada (D3).
   */
  rutas?: RutaPull[];
  /**
   * T-74. Las filas de `promocion` cuyo `sucursal_id` es la sucursal del
   * vendedor: las de `todos`, las de `prospecto` y las de `cliente` creadas en
   * esa sucursal (se crean en la del cliente). El filtro es la columna
   * `sucursal_id` de la promocion, no la cartera de clientes. Opcional: un
   * servidor anterior a este ticket no la manda y la tablet trabaja sin
   * promociones (la ficha dice "Sin promoción").
   */
  promociones?: PromocionPull[];
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
   * Hoy solo la venta lo lleva, y en ella es obligatorio (T-16). La `jornada`
   * no es una nota que nadie firme, y la cobranza no lleva folio (T-21): el
   * servidor ignora el que llegue.
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
  /**
   * El # del block de papel, **opcional**: el block solo se usa cuando falla
   * el sistema (cliente, 2026-10-06). `null` es "sin nota". No es unico: lo
   * que identifica la venta es el folio.
   */
  num_nota?: string | null;
  contado_credito: 'contado' | 'credito';
  factura: 'N/A' | 'pendiente';
  comentarios: string | null;
  /** De 1 a 50, sin presentacion repetida. */
  lineas: LineaVenta[];
  /**
   * T-74 (D13). Opcional y aditivo: ausente en una tablet anterior y en la
   * venta del portal (D9). Si viene, por cada presentacion la suma de
   * `cantidad` de sus regalos tiene que ser igual a `cantidad_promocion` de la
   * linea; si no cuadra es `datos-invalidos`. El servidor NO rechaza por la
   * regla de negocio: las piezas ya se entregaron en la calle.
   */
  regalos?: RegaloVenta[];
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
  /** Nombre del negocio. */
  nombre: string;
  telefono: string;
  /**
   * Nombre del encargado: quien atiende el negocio. Obligatorio junto con
   * `nombre` y `telefono` (confirmado por el cliente en junta, 2026-09-29 —
   * antes era opcional). No subió la versión del contrato: ver
   * `docs/contrato-sincronizacion.md` §6 (nota de T-69).
   */
  encargado: string;
  /** Del catalogo `tipos_negocio` que baja en el `pull`. */
  tipo_negocio_id: string | null;
  comentarios: string | null;
  /**
   * T-72 (D2): "Dirección del negocio", hasta 300. Obligatoria al capturar sin
   * GPS (`validarAltaProspecto`); el servidor la geocodifica despues del commit.
   * Opcional en el cable.
   */
  domicilio?: string | null;
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
 * Metodo de un abono que baja en el pull (T-21): los de cobro mas `saldo_favor`
 * (la oficina aplico saldo a favor). La tablet nunca lo manda en un push.
 */
export type MetodoPagoAbono = MetodoPago | 'saldo_favor';

/**
 * `datos` de una operacion `tipo: "cobranza"` (T-20).
 *
 * Un pago sobre UNA nota; el servidor reparte el excedente a las otras notas
 * del cliente y al saldo a favor. `cliente_id` va en el sobre y es
 * obligatorio. **Sin folio** (T-21): la cobranza no lleva folio.
 */
export type DatosCobranza = {
  venta_nota_id: string;
  /** Entero, de 1 a 999_999_999_999. */
  monto_centavos: number;
  metodo_pago: MetodoPago;
  /** `AAAA-MM-DD`, no posterior a `fecha_operacion`. */
  fecha_pago: string;
};

/**
 * `datos` de una operacion `tipo: "jornada"` (T-38): el dia ya cerrado. Copia
 * del tipo del backend. Solo se suben jornadas cerradas, asi que van los cinco.
 */
export type DatosJornada = {
  vehiculo_id: string;
  km_inicial: number;
  km_final: number;
  /** ISO-8601 con zona. */
  abierta_en: string;
  /** ISO-8601 con zona. */
  cerrada_en: string;
};

/**
 * `datos` de una operacion `tipo: "ruta-alta"` (T-37). Copia del tipo del
 * backend: el cliente va aqui y no en el sobre; el dia es `fecha_operacion`.
 */
export type DatosRutaAlta = {
  cliente_id: string;
};

/**
 * `datos` de una operacion `tipo: "visita"` (T-39). Copia del tipo del backend.
 */
export type DatosVisita = {
  /** uuid de `motivo_visita` (vivo o dado de baja). */
  motivo_visita_id: string;
  /** Instante ISO-8601 con zona en que el vendedor la guardo. */
  visitada_en: string;
  /** Hasta 500 caracteres. */
  observaciones?: string | null;
  /** Quien atendio; hasta 120 caracteres. */
  atendio?: string | null;
  /** -90..90; las dos o ninguna. */
  lat?: number | null;
  /** -180..180. */
  lng?: number | null;
  /** Precision del GPS en metros, >= 0. */
  precision_m?: number | null;
  /** Hasta 300; obligatoria (no vacia) si no hay lat/lng. */
  direccion_texto?: string | null;
};

/**
 * `datos` de una operacion `tipo: "gasto"` (T-30/T-31). Copia del tipo del
 * backend: sin `cliente_id` ni folio en el sobre; la clave es el id del gasto.
 */
export type DatosGasto = {
  /** uuid de `campo_egreso` (vivo o dado de baja). */
  campo_egreso_id: string;
  /** Entero, de 1 a 999_999_999_999. */
  monto_centavos: number;
  /** Instante ISO-8601 con zona en que el vendedor lo guardo. */
  registrado_en: string;
  /** Hasta 200 caracteres. */
  comentario?: string | null;
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
