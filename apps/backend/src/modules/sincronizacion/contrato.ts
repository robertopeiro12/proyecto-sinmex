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

/**
 * Tipos de operacion que la tablet puede empujar.
 *
 * Cada uno corresponde a un modulo de negocio. T-07 definio por donde viajan y
 * los guarda en `sync_operacion`; el ticket de cada modulo fija la forma de su
 * `datos` y lo proyecta a sus tablas (ADR-0009).
 *
 * Hecho: T-16 — `venta` (cabecera + lineas, ver {@link DatosVenta} y [[Venta-Nota]]).
 * Hecho: T-20 — `cobranza` (abono/liquidacion sobre una nota, ver {@link DatosCobranza} y [[Cobranza-Abono]]).
 * TODO: T-27 — `gasto` (hielo, gasolina, reparacion, adelanto).
 * TODO: T-33 — `merma` (los 3 tipos de merma del documento de julio 2026).
 * TODO: T-39 — `ruta` (visitas, orden real, tiempos y GPS).
 * TODO: T-XX — la jornada (vehiculo + kilometraje inicial/final) no tiene tabla
 *       propia en Postgres todavia; hoy solo se recibe y se guarda.
 *
 * Hecho: T-40 — `prospecto`, el unico tipo que **crea** una fila de catalogo
 *        (`cliente` con `tipo = 'prospecto'`) en vez de una de operacion. Es un
 *        tipo nuevo, es decir un cambio **aditivo**: no sube la version.
 */
export const TIPOS_OPERACION = [
  'jornada',
  'venta',
  'cobranza',
  'gasto',
  'merma',
  'ruta',
  'prospecto',
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
  /**
   * `datos` no cumple la forma de su tipo (o la operacion entera no es un
   * objeto). T-16 amplia su significado: en una venta, el `motivo` nombra el
   * campo (`lineas[2].cantidad: ...`). Es un bug de la tablet, no un dato de
   * campo que el vendedor pueda corregir.
   */
  'datos-invalidos',
  /** El `cliente_id` no existe o no es de la sucursal del vendedor. */
  'cliente-fuera-de-alcance',
  /**
   * El `folio` no tiene el formato de [[Folios|ADR-0001]], o contradice a la
   * propia operacion (dice otra sucursal, otra fecha u otro vendedor). T-14.
   */
  'folio-invalido',
  /**
   * **Colision de folios.** Otra operacion —normalmente de otra tablet— ya
   * subio este mismo folio. Es el criterio de aceptacion de T-14: el servidor
   * lo detecta y **no lo acepta en silencio**.
   *
   * Ojo con la diferencia: esto **no** es un reintento. Un reenvio del mismo
   * lote trae la misma `clave` y se resuelve como `duplicada`; aqui son dos
   * hechos de negocio distintos que dicen tener el mismo identificador.
   */
  'folio-duplicado',
  /**
   * Una linea de venta nombra una presentacion que no se vende: no existe,
   * esta dada de baja, o su producto esta inactivo o dado de baja. T-16.
   *
   * No es un bug de la tablet: su catalogo pudo quedarse viejo. Se reintenta
   * en la siguiente sincronizacion, que ademas le baja el catalogo nuevo.
   */
  'presentacion-inactiva',
  /**
   * Una linea con cantidad > 0 y el cliente no tiene **ningun** precio para
   * esa presentacion: ni vigente a `fecha_operacion` ni asignado despues,
   * hasta hoy (enmienda a D12: el portal fecha los precios desde hoy, asi que
   * asignarlo en el portal y volver a sincronizar recupera la venta). T-16.
   *
   * Comprueba **existencia, nunca valor**: el precio que manda la tablet es el
   * de la nota que firmo el cliente y no se compara con el del servidor.
   */
  'precio-no-asignado',
  /**
   * El `tipo_negocio_id` de un alta de prospecto no existe o esta dado de
   * baja. T-40.
   *
   * **No es un bug de la tablet**: su catalogo de tipos de negocio pudo
   * quedarse viejo mientras estaba en ruta, o el administrador pudo dar de baja
   * ese giro el mismo dia. Se reintenta en la siguiente sincronizacion, que
   * ademas le baja el catalogo nuevo — igual que `presentacion-inactiva`.
   */
  'tipo-negocio-inexistente',
  /**
   * La nota que se cobra no existe, su cliente no es de la sucursal del
   * vendedor, o no es del `cliente_id` del sobre. T-20.
   *
   * Una nota que en el servidor ya esta pagada, de cuenta perdida, de promocion o
   * borrada **no** cae aqui: el cobro se
   * acepta y el monto va a las otras notas y al saldo a favor (el dinero si se
   * cobro). Una cobranza sobre una venta que aun no se proyecto si cae aqui, y
   * la tablet la reenvia en cada sincronizacion.
   */
  'nota-no-encontrada',
] as const;

export type CodigoRechazo = (typeof CODIGOS_RECHAZO)[number];

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

/** Catalogo de metodos de pago ([[Cobranza-Abono]]). En la app el default es `efectivo`. */
export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

/**
 * `datos` de una operacion `tipo: "cobranza"` (T-20).
 *
 * Un pago del cliente sobre UNA nota que eligio el vendedor. `cliente_id` y
 * `folio` viajan en el **sobre** y en una cobranza son obligatorios. El
 * servidor reparte el monto: primero la nota elegida hasta su saldo, despues
 * las otras notas pendientes del cliente de la mas vieja a la mas nueva, y lo
 * que sobre queda como saldo a favor. Un monto mayor al saldo se acepta.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosCobranza = {
  /** uuid de la `venta_nota` (el `id` de una nota pendiente del pull). */
  venta_nota_id: string;
  /** Entero, de 1 a 999_999_999_999. */
  monto_centavos: number;
  metodo_pago: MetodoPago;
  /** `AAAA-MM-DD`, no posterior a `fecha_operacion`. Informativa: el corte cuenta por `fecha_operacion`. */
  fecha_pago: string;
};

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
  /**
   * Las 2 letras del vendedor dentro del [[Folios|folio]] (5o segmento). T-14.
   *
   * **Lo asigna el servidor y la tablet lo usa tal cual.** No lo deriva ella de
   * `nombre` aunque podria: dos vendedores con las mismas iniciales chocarian,
   * y la tablet **no puede detectarlo** porque de `vendedores` solo baja su
   * propia ficha — no ve a sus companeros. Solo el servidor tiene la
   * visibilidad global para desambiguar.
   *
   * `null` mientras un vendedor no lo tenga asignado. Una tablet sin segmento
   * **no puede emitir folios** y debe decirlo en voz alta, nunca inventarse las
   * iniciales por su cuenta: eso reintroduciria en silencio la ambiguedad que
   * sigue **pendiente de confirmar con el cliente** (ver ADR-0007).
   *
   * Es un campo **aditivo**: no sube la version del contrato. Un servidor que
   * no lo mande deja a la tablet sin poder foliar, pero no rompe nada de lo que
   * ya funcionaba. T-16 lo hizo obligatorio para `venta` **sin** subir
   * `CONTRATO_ACTUAL`: una venta sin folio es `datos-invalidos` por operacion, y
   * una tablet vieja (que no captura ventas) no se entera del cambio.
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
  /** Numero puro ("5", no "5%"). Ver [[Cliente]]. */
  pct_comision: number | null;
  promocion: 'ninguna' | '10+1' | '20+1';
  plazo_credito_dias: number | null;
  lat: number | null;
  lng: number | null;
  sucursal_id: string;
  /**
   * Saldo a favor del cliente, en centavos: la suma de sus movimientos vivos de
   * `saldo_favor_movimiento` (T-20, D5). La tablet solo lo muestra; usarlo es del
   * portal. Aditivo: una tablet vieja lo ignora.
   */
  saldo_favor_centavos: number;
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

/** Un abono vivo de una nota, para mostrar los pagos previos al cobrar (T-20). */
export interface AbonoPull {
  fecha_pago: string;
  monto_centavos: number;
  metodo_pago: MetodoPago;
}

/**
 * Nota por cobrar, para poder seleccionarla al cobrar/abonar sin red.
 *
 * - `saldo_centavos` es **derivado** (T-20, D7): `monto_total − Σ abonos vivos`,
 *   nunca negativo. `cobranza_abono.saldo_pendiente` es solo una foto.
 * - Con `desde`, tambien bajan las notas a credito que dejaron de estar
 *   pendientes (pagadas, de cuenta perdida, borradas) con `activo: 0`, para que la
 *   tablet deje de ofrecerlas.
 * - `status` **no se ensancha**: una nota cerrada viaja como `abonado` si tiene
 *   abonos y como `pendiente` si no. Una tablet vieja guarda esta tabla con un
 *   CHECK de esos dos valores y perderia el pull entero con otro.
 */
export interface NotaPendientePull extends FilaSincronizable {
  folio: string;
  num_nota: string;
  fecha: string;
  cliente_id: string;
  status: 'pendiente' | 'abonado';
  monto_total_centavos: number;
  saldo_centavos: number;
  /** Vivos, por fecha de pago. Aditivo: una tablet vieja lo ignora. */
  abonos: AbonoPull[];
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
    /** T-40. Aditiva: una tablet vieja la ignora. */
    tipos_negocio: TipoNegocioPull[];
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
