/**
 * Validacion y normalizacion de `datos` de un alta de prospecto (T-40).
 *
 * Pura, sin base de datos: decide si el alta tiene la FORMA correcta. Lo que
 * necesita consultar (que el tipo de negocio exista) lo decide
 * `ClientesService.crearProspecto` dentro de la transaccion.
 *
 * Recibe un objeto sin tipar y no un DTO, por el mismo motivo que
 * `datos-venta.ts` (T-16): el JSON viene de una tablet que puede llevar semanas
 * capturando offline, y la regla del contrato es rechazar **por operacion** con
 * un motivo, nunca tumbar el lote. Por eso tambien comprueba lo que haria
 * reventar a Postgres:
 *
 * - un uuid mal formado en `tipo_negocio_id` (`invalid input syntax for type
 *   uuid`, 22P02);
 * - una coordenada que no cabe en `numeric(9,6)` (`numeric field overflow`,
 *   22003).
 *
 * Cualquiera de las dos saldria como **500 para todo el lote**, y la tablet
 * traduce un 5xx a "sin red" y reintentaria para siempre en silencio.
 */

export interface ProspectoNormalizado {
  /** Nombre del negocio. Es lo unico obligatorio. */
  nombre: string;
  telefono: string;
  /** Nombre del encargado. */
  encargado: string | null;
  tipoNegocioId: string | null;
  comentarios: string | null;
  /**
   * Ubicacion del negocio. Las dos o ninguna.
   *
   * `null` es un caso **normal, no un error**: el vendedor pudo negar el permiso
   * de ubicacion o estar sin senal de GPS, y eso no puede impedirle registrar al
   * prospecto. La administracion ya monitorea que clientes tienen la ubicacion
   * pendiente (ver [[Cliente]]).
   */
  lat: number | null;
  lng: number | null;
}

export type ResultadoDatosProspecto =
  | { ok: true; prospecto: ProspectoNormalizado }
  | {
      ok: false;
      /** El campo que fallo, p. ej. `lat`. */
      campo: string;
      /** Empieza por `campo`: es lo que guarda la tablet en `sync_error`. */
      motivo: string;
    };

/** `cliente.nombre` es `text`, pero un nombre de negocio mas largo es un dedazo. */
export const LARGO_MAX_NOMBRE = 200;
export const LARGO_MAX_TELEFONO = 30;
export const LARGO_MAX_ENCARGADO = 120;
export const LARGO_MAX_COMENTARIO = 500;

/**
 * `numeric(9,6)` de Postgres: 3 digitos de parte entera y 6 decimales. Los
 * rangos reales de la Tierra (±90 / ±180) caben y son mas estrictos, asi que se
 * validan esos: una latitud de 200 no es una coordenada, es un dato corrupto.
 */
const MAX_LAT = 90;
const MAX_LNG = 180;

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalido(campo: string, motivo: string): ResultadoDatosProspecto {
  return { ok: false, campo, motivo: `${campo}: ${motivo}` };
}

/** Texto recortado no vacio, o `null`. */
function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

/**
 * Campo de texto opcional: `null`/ausente pasa, un tipo que no sea texto no.
 *
 * Devuelve el resultado de error o el valor, para que quien llama no tenga que
 * repetir cuatro veces el mismo bloque.
 */
function opcional(
  campo: string,
  valor: unknown,
  largoMax: number,
):
  | { ok: true; valor: string | null }
  | { ok: false; error: ResultadoDatosProspecto } {
  if (valor === undefined || valor === null) return { ok: true, valor: null };
  if (typeof valor !== 'string') {
    return { ok: false, error: invalido(campo, 'debe ser texto.') };
  }
  const limpio = valor.trim();
  if (limpio.length > largoMax) {
    return {
      ok: false,
      error: invalido(campo, `no puede pasar de ${largoMax} caracteres.`),
    };
  }
  return { ok: true, valor: limpio === '' ? null : limpio };
}

export function normalizarDatosProspecto(
  datos: Record<string, unknown>,
): ResultadoDatosProspecto {
  const nombre = texto(datos.nombre);
  if (nombre === null) {
    return invalido('nombre', 'es obligatorio: es el nombre del negocio.');
  }
  if (nombre.length > LARGO_MAX_NOMBRE) {
    return invalido(
      'nombre',
      `no puede pasar de ${LARGO_MAX_NOMBRE} caracteres.`,
    );
  }

  // Obligatorio: el cliente lo dicto y `cliente.telefono` es `not null` tambien
  // para un prospecto (esa columna NO se relajo — un prospecto al que no se
  // puede llamar no sirve de nada).
  const telefono = texto(datos.telefono);
  if (telefono === null) {
    return invalido('telefono', 'es obligatorio: es el contacto del negocio.');
  }
  if (telefono.length > LARGO_MAX_TELEFONO) {
    return invalido(
      'telefono',
      `no puede pasar de ${LARGO_MAX_TELEFONO} caracteres.`,
    );
  }

  const encargado = opcional('encargado', datos.encargado, LARGO_MAX_ENCARGADO);
  if (!encargado.ok) return encargado.error;

  const comentarios = opcional(
    'comentarios',
    datos.comentarios,
    LARGO_MAX_COMENTARIO,
  );
  if (!comentarios.ok) return comentarios.error;

  // El uuid se comprueba AQUI y no se deja a la llave foranea: `where id =
  // 'abc'` no devuelve cero filas, hace que Postgres reviente con 22P02 y eso
  // seria un 500 para todo el lote.
  let tipoNegocioId: string | null = null;
  if (datos.tipo_negocio_id !== undefined && datos.tipo_negocio_id !== null) {
    if (
      typeof datos.tipo_negocio_id !== 'string' ||
      !RE_UUID.test(datos.tipo_negocio_id)
    ) {
      return invalido(
        'tipo_negocio_id',
        'debe ser el identificador de un tipo de negocio.',
      );
    }
    // En minusculas, igual que `presentacion_id` en una venta: Postgres compara
    // uuid sin importar mayusculas y asi la fila que se guarda es comparable.
    tipoNegocioId = datos.tipo_negocio_id.toLowerCase();
  }

  const ubicacion = normalizarUbicacion(datos.lat, datos.lng);
  if (!ubicacion.ok) return ubicacion.error;

  // La FOTO no se valida porque todavia no se guarda en ningun lado: falta
  // decidir donde vive el archivo (candidato Supabase Storage; el alcance de
  // Supabase es lo que ADR-0002 dejo abierto). El contrato reserva el campo
  // `foto: null` para que la tablet ya lo mande y el dia que se decida no haya
  // que cambiar el sobre. Ver la nota `T-40 Registro de Prospectos` del vault.

  return {
    ok: true,
    prospecto: {
      nombre,
      telefono,
      encargado: encargado.valor,
      tipoNegocioId,
      comentarios: comentarios.valor,
      lat: ubicacion.lat,
      lng: ubicacion.lng,
    },
  };
}

/**
 * Latitud y longitud: **las dos o ninguna**.
 *
 * Media coordenada no ubica nada y ademas se veria en el portal como un punto en
 * el meridiano cero, que es peor que no tener ubicacion: parece un dato bueno.
 */
function normalizarUbicacion(
  latCruda: unknown,
  lngCruda: unknown,
):
  | { ok: true; lat: number | null; lng: number | null }
  | { ok: false; error: ResultadoDatosProspecto } {
  const faltaLat = latCruda === undefined || latCruda === null;
  const faltaLng = lngCruda === undefined || lngCruda === null;

  if (faltaLat && faltaLng) return { ok: true, lat: null, lng: null };
  if (faltaLat !== faltaLng) {
    return {
      ok: false,
      error: invalido(
        'lat/lng',
        'la ubicacion va completa o no va: media coordenada no ubica nada.',
      ),
    };
  }

  const lat = numeroEnRango(latCruda, MAX_LAT);
  if (lat === null) {
    return {
      ok: false,
      error: invalido(
        'lat',
        `debe ser un numero entre -${MAX_LAT} y ${MAX_LAT}.`,
      ),
    };
  }
  const lng = numeroEnRango(lngCruda, MAX_LNG);
  if (lng === null) {
    return {
      ok: false,
      error: invalido(
        'lng',
        `debe ser un numero entre -${MAX_LNG} y ${MAX_LNG}.`,
      ),
    };
  }
  return { ok: true, lat, lng };
}

/**
 * Numero finito en `[-maximo, maximo]`, o `null`.
 *
 * `'32.5'` no cuenta: el contrato manda numeros. Y `NaN`/`Infinity` tampoco:
 * `Number.isFinite` los descarta, que si no acabarian en Postgres como `NaN` en
 * una columna `numeric` — legal para Postgres y sin sentido como coordenada.
 */
function numeroEnRango(valor: unknown, maximo: number): number | null {
  return typeof valor === 'number' &&
    Number.isFinite(valor) &&
    valor >= -maximo &&
    valor <= maximo
    ? valor
    : null;
}
