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
 * Hecho: T-30/T-31 — `gasto`, un gasto de la ruta pagado con el efectivo
 *        cobrado (ver {@link DatosGasto}); se proyecta a la tabla `gasto` con
 *        `id = clave`. El tipo ya existia: fijar su forma es aditivo y no sube
 *        la version.
 * TODO: T-33 — `merma` (los 3 tipos de merma del documento de julio 2026).
 * Hecho: T-39 — `visita`, una visita sin venta con su motivo (ver
 *        {@link DatosVisita}); se proyecta a la tabla `visita` con `id = clave`.
 *        **No** reutiliza `ruta`, que sigue reservado y se guarda sin proyectar.
 *        Tipo nuevo = cambio aditivo: no sube la version.
 * Hecho: T-37 — `ruta-alta`, un cliente que el vendedor agrego a su ruta del
 *        dia (ver {@link DatosRutaAlta}); se proyecta a la tabla `ruta` con
 *        `origen = 'vendedor'`. **No** reutiliza `ruta`, que queda reservado a
 *        la visita (que usa `visita`, T-39), y se guarda sin proyectar. Tipo
 *        nuevo = cambio aditivo: no sube la version.
 * Hecho: T-38 — `jornada` (vehiculo + kilometraje inicial/final del dia ya
 *        cerrado, ver {@link DatosJornada}); se proyecta a la tabla `jornada`.
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
  'ruta-alta',
  'visita',
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
  /**
   * `datos` de una jornada no tiene la forma de {@link DatosJornada}: falta un
   * campo, un km no es un numero entre 0 y 999 999 999.9, o un instante no es
   * ISO-8601 con zona. T-38. Es un bug de la tablet; el `motivo` nombra el campo.
   * Se rechaza antes de abrir la transaccion.
   */
  'jornada-datos-invalidos',
  /**
   * `km_final` es menor que `km_inicial`: el odometro no retrocede. T-38. La
   * tablet ya lo impide al cerrar el dia; si llega aqui, el dato se corrompio.
   */
  'jornada-km-invalido',
  /**
   * El vehiculo de la jornada no existe, esta dado de baja (`deleted_at`) o es
   * de otra sucursal que la del vendedor del token. T-38. Uno **desactivado**
   * (`activo = false`) si entra: el kilometraje se recorrio igual.
   *
   * No es un bug de la tablet: su catalogo pudo quedarse viejo. Se reintenta en
   * la siguiente sincronizacion, como `presentacion-inactiva`.
   */
  'vehiculo-inexistente',
  /**
   * Ya hay una jornada viva de ese vendedor en esa fecha, subida con **otra**
   * clave de idempotencia (otra tablet, o una fila local rehecha). T-38. Un
   * reenvio con la MISMA clave no cae aqui: el buzon lo resuelve antes como
   * `duplicada`.
   */
  'jornada-duplicada',
  /**
   * `datos.cliente_id` de un alta de ruta falta o no es un uuid, o el sobre
   * trae un folio (un alta de ruta no es una nota que nadie firme). T-37. Bug
   * de la tablet. Se rechaza antes de abrir la transaccion.
   */
  'ruta-datos-invalidos',
  /**
   * El cliente de un alta de ruta no existe, esta dado de baja (`deleted_at`),
   * es de otra sucursal que la del vendedor del token, o es un prospecto (a un
   * prospecto no se le vende, D7). T-37. No es un bug: el catalogo de la tablet
   * pudo quedarse viejo. Se reintenta en la siguiente sincronizacion.
   */
  'cliente-inexistente',
  /**
   * Ya habia una fila viva de ese vendedor, fecha y cliente en la ruta,
   * subida con **otra** clave (la oficina y el vendedor agregaron al mismo
   * cliente). T-37. La misma clave es `duplicada`, no esto. **La tablet la
   * trata como aplicada**: no es un error del vendedor.
   */
  'ruta-duplicada',
  /**
   * El `motivo_visita_id` de una visita no existe en el catalogo. T-39. Un
   * motivo **dado de baja si se acepta**: el vendedor lo eligio sin red cuando
   * estaba vivo. Esto solo cae con un id que nunca existio (bug de la tablet).
   */
  'motivo-visita-inexistente',
  /**
   * El id de la visita (su clave) ya esta ocupado por otro registro. T-39. El
   * mismo vendedor con la misma clave es `duplicada`, no esto. El motivo es
   * neutro a proposito: no confirma que hay detras del id.
   */
  'visita-id-ocupado',
  /**
   * El `campo_egreso_id` de un gasto no existe en el catalogo. T-30/T-31. Un
   * campo **dado de baja si se acepta**, y tampoco se mira "se usa en la app":
   * la oficina pudo cambiarlo mientras la tablet estaba sin red. Esto solo cae
   * con un id que nunca existio (bug de la tablet).
   */
  'campo-egreso-inexistente',
  /**
   * El id del gasto (su clave) ya esta ocupado por otro registro. T-30/T-31. El
   * mismo vendedor con la misma clave es `duplicada`, no esto. Motivo neutro.
   */
  'gasto-id-ocupado',
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
  /**
   * El # del block de papel, **opcional**: el block solo se usa cuando falla
   * el sistema (cliente, 2026-10-06). Ausente, `null` o en blanco es "sin
   * nota". No es unico: lo que identifica la venta es el folio.
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
 * T-75 (D2): la `clave` de un prospecto **es el id** con el que el servidor
 * crea el `cliente`. Debe ser uuid (la tablet manda `randomUUID()`); si no lo
 * es, `datos-invalidos`. Asi una venta capturada sin red contra ese prospecto
 * (que la tablet ya registro con ese id) encuentra a su cliente al subir.
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
   * T-72 (D2): la direccion del negocio que escribio el vendedor. Hasta 300
   * caracteres; se recorta y un texto vacio cuenta como `null`. La tablet la
   * exige cuando no hay GPS; el servidor solo valida la forma (mas de 300 o no
   * texto = `datos-invalidos`, motivo `domicilio: …`). Se guarda en
   * `cliente.domicilio` y, sin `lat`/`lng`, el servidor la geocodifica despues
   * del commit, sin que el push espere.
   *
   * Opcional: una tablet anterior no la manda. Aditivo, `CONTRATO_ACTUAL` sigue
   * en 1.
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

/** Catalogo de metodos de pago ([[Cobranza-Abono]]). En la app el default es `efectivo`. */
export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

/**
 * Metodo de un abono que BAJA en el pull (T-21): el de los cobros mas
 * `saldo_favor`, que es la oficina aplicando saldo a favor (no entro dinero).
 * La tablet nunca lo manda en un push: `DatosCobranza.metodo_pago` sigue siendo
 * {@link MetodoPago}. Aditivo: una tablet vieja guarda los abonos como JSON sin
 * validar el metodo y lo muestra tal cual.
 */
export type MetodoPagoAbono = MetodoPago | 'saldo_favor';

/**
 * `datos` de una operacion `tipo: "cobranza"` (T-20).
 *
 * Un pago del cliente sobre UNA nota que eligio el vendedor. `cliente_id`
 * viaja en el **sobre** y es obligatorio. **No lleva folio** (T-21, cliente
 * 2026-10-07: "la cobranza no lleva folio"): si llega uno —una tablet sin
 * actualizar— se ignora sin validarlo y no se guarda. No subio la version:
 * ver `docs/contrato-sincronizacion.md` §6.
 *
 * El servidor reparte el monto: primero la nota elegida hasta su saldo,
 * despues las otras notas pendientes del cliente de la mas vieja a la mas
 * nueva, y lo que sobre queda como saldo a favor. Un monto mayor al saldo se
 * acepta.
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

/**
 * `datos` de una operacion `tipo: "jornada"` (T-38): el dia ya CERRADO.
 *
 * Es el sobre que la tablet ya mandaba desde T-07 (`fuente-jornadas.ts`); T-38
 * solo lo fija y lo proyecta a la tabla `jornada`. La tablet solo sube jornadas
 * cerradas (el buzon es de solo escritura hasta T-43), asi que los cinco campos
 * van siempre. El sobre no lleva `folio` (no es una nota que nadie firme) ni
 * `cliente_id`. Cualquier otro campo dentro de `datos` se ignora.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosJornada = {
  /** uuid del vehiculo que eligio al abrir el dia; de la sucursal del vendedor. */
  vehiculo_id: string;
  /** Numero finito entre 0 y 999 999 999.9. Se guarda con una decima. */
  km_inicial: number;
  /** Igual que `km_inicial`, y no menor que el: el odometro no retrocede. */
  km_final: number;
  /** Instante ISO-8601 **con zona** en que abrio el dia. */
  abierta_en: string;
  /** Instante ISO-8601 **con zona** en que lo cerro. */
  cerrada_en: string;
};

/**
 * `datos` de una operacion `tipo: "ruta-alta"` (T-37): un cliente que el
 * vendedor agrego a mano a su ruta del dia.
 *
 * El cliente va en `datos` y **no** en el sobre a proposito: con el
 * `cliente_id` del sobre, el alcance generico del push responderia
 * `cliente-fuera-de-alcance` y la tablet no podria distinguir un prospecto (que
 * nunca entra a la ruta, D7) de un cliente que el portal movio de sucursal. El
 * dia de la ruta es `fecha_operacion`, tal cual la manda la tablet. Sin folio.
 *
 * El ORDEN no viaja: el que arrastra el vendedor se queda en la tablet (D4); el
 * servidor pone la fila al final de la ruta de ese dia.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosRutaAlta = {
  /** uuid de un `cliente` (no prospecto) de la sucursal del vendedor. */
  cliente_id: string;
};

/**
 * `datos` de una operacion `tipo: "visita"` (T-39): una visita sin venta.
 *
 * `cliente_id` va en el **sobre** (se comprueba con el alcance normal del
 * lote) y no lleva folio. La `clave` **es el id** de la fila `visita`: debe ser
 * uuid. Los textos se recortan y uno vacio se guarda como `null`.
 *
 * Ubicacion: `lat`/`lng` van las dos o ninguna; sin ellas, `direccion_texto` es
 * obligatoria (no vacia). El servidor **no** revisa si el motivo exige foto o
 * nombre: lo exige la tablet al guardar (la oficina pudo cambiar las casillas
 * mientras la tablet estaba sin red).
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
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
 * `datos` de una operacion `tipo: "gasto"` (T-30/T-31): un gasto de la ruta
 * (hielo, gasolina, reparacion del vehiculo, adelanto de sueldo) que el
 * vendedor pago con el efectivo que cobro.
 *
 * El sobre **no** lleva `cliente_id` (un gasto no es de un cliente) ni folio.
 * La `clave` **es el id** de la fila `gasto`: debe ser uuid. El dia al que
 * cuenta es `fecha_operacion`, nunca re-derivado de `registrado_en`. El metodo
 * no viaja: en la app siempre es efectivo de la cobranza del dia.
 *
 * El servidor **no** revisa `se_usa_en_app` del campo, y uno dado de baja se
 * acepta.
 *
 * Es `type` y no `interface` por la misma razon que {@link DatosVenta}.
 */
export type DatosGasto = {
  /** uuid de `campo_egreso` (vivo o dado de baja). */
  campo_egreso_id: string;
  /** Entero, de 1 a 999_999_999_999. */
  monto_centavos: number;
  /** Instante ISO-8601 con zona en que el vendedor lo guardo. */
  registrado_en: string;
  /** Hasta 200 caracteres; se recorta y uno vacio es `null`. */
  comentario?: string | null;
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

/**
 * Un motivo de visita sin venta (T-39, D4): el catalogo de la pantalla
 * "Visita sin venta". Global (no cuelga de sucursal), como `tipos_negocio`.
 * Coleccion nueva = aditiva. Incremental por `actualizado_en`; la baja logica
 * viaja como `activo: 0` y la tablet deja de ofrecerlo (una visita ya guardada
 * con el sigue subiendo: el push lo acepta).
 */
export interface MotivoVisitaPull extends FilaSincronizable {
  nombre: string;
  /** La tablet no deja guardar la visita sin foto. */
  exige_foto: boolean;
  /** La tablet no deja guardar la visita sin el nombre de quien atendio. */
  exige_atendio: boolean;
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
   * T-72 (D3): de donde salio la coordenada: `'gps'` (la tablet al dar de alta
   * el prospecto), `'geocodificada'` (el servidor, con Google) o `'manual'` (la
   * oficina en el portal); `null` sin coordenada. Cuando el servidor geocodifica
   * le toca `updated_at`, asi que coordenada y origen bajan solos en el pull
   * incremental. Aditivo: una tablet anterior lo ignora.
   */
  ubicacion_origen: 'gps' | 'geocodificada' | 'manual' | null;
  sucursal_id: string;
  /**
   * Saldo a favor del cliente, en centavos: la suma de sus movimientos vivos de
   * `saldo_favor_movimiento` (T-20, D5). La tablet solo lo muestra; usarlo es del
   * portal. Aditivo: una tablet vieja lo ignora.
   */
  saldo_favor_centavos: number;
  /**
   * T-39 (D9): cuando el servidor recibio la foto del cliente (ISO), o `null`
   * si no tiene. La ficha de la tablet la baja de `GET /sync/foto/cliente/:id`
   * cuando no la tiene o la tiene mas vieja. Aditivo: una tablet vieja lo ignora.
   */
  foto_subida_en: string | null;
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
  metodo_pago: MetodoPagoAbono;
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
  /** `null` si la venta no tuvo nota de papel (lo normal). */
  num_nota: string | null;
  fecha: string;
  cliente_id: string;
  status: 'pendiente' | 'abonado';
  monto_total_centavos: number;
  saldo_centavos: number;
  /** Vivos, por fecha de pago. Aditivo: una tablet vieja lo ignora. */
  abonos: AbonoPull[];
}

/**
 * Una fila de la ruta diaria del vendedor del token (T-37, D12).
 *
 * - Solo `tipo = 'diaria'` y solo del vendedor del token.
 * - Ventana de fechas por el reloj del servidor: desde ayer en adelante, sin
 *   tope: una ruta futura debe bajar en el pull siguiente a su creacion (con
 *   tope y el cursor por `updated_at`, una ruta asignada a 8+ dias nunca
 *   entraba al pull incremental). La tablet decide que dia mostrar con su reloj
 *   local (Tijuana).
 * - Incremental por `updated_at` como las demas colecciones. Una fila que la
 *   oficina quito viaja con `activo: 0` (baja como bandera, nunca como
 *   ausencia); sin `desde` bajan solo las vivas.
 *
 * Coleccion nueva = cambio aditivo: no sube la version.
 */
export interface RutaPull extends FilaSincronizable {
  cliente_id: string;
  /** `AAAA-MM-DD`, el dia de la asignacion. */
  fecha: string;
  /** El orden de la oficina. La tablet lo usa solo si el vendedor no reordeno. */
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
    /** T-39. Aditiva: una tablet vieja la ignora. */
    motivos_visita: MotivoVisitaPull[];
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
  /** T-37. La ruta diaria del vendedor (ver {@link RutaPull}). Aditiva. */
  rutas: RutaPull[];
  /**
   * T-74. Las filas de `promocion` cuyo `sucursal_id` es la sucursal del
   * vendedor: las de `todos`, las de `prospecto` y las de `cliente` creadas en
   * esa sucursal (se crean en la del cliente). El filtro es la columna
   * `sucursal_id` de la promocion, no la cartera de clientes (ver
   * {@link PromocionPull}). Aditiva: una tablet vieja la ignora.
   */
  promociones: PromocionPull[];
}
