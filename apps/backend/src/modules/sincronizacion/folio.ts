/**
 * El folio de operacion: formato y coherencia (T-14).
 *
 * La regla de negocio vive en [[Folios]] y la decision en
 * [[ADR-0001 Formato de folios]]. Aqui solo se implementa lo que ese ADR fija,
 * sin anadir nada: **12 caracteres en 6 segmentos de 2**.
 *
 * ```
 *   T J 2 6 0 3 2 2 A P 0 5
 *   └┬┘ └┬┘ └┬┘ └┬┘ └┬┘ └┬┘
 *    │   │   │   │   │   └── operacion del dia (consecutivo, reinicia en 01)
 *    │   │   │   │   └────── vendedor (iniciales; ver la advertencia de abajo)
 *    │   │   │   └────────── dia
 *    │   │   └────────────── mes
 *    │   └────────────────── ano (2 digitos)
 *    └────────────────────── sucursal (codigo de 2 letras)
 * ```
 *
 * Ejemplos del ADR: `TJ220313AP05` y `TJ260322AP05`.
 *
 * > [!danger] Quien emite: la TABLET, offline
 * > ADR-0001 **descarta** generarlo en el servidor: la tablet opera sin red
 * > toda la jornada y el folio se escribe en la nota fisica que el cliente
 * > firma, en campo. No puede esperar a la sincronizacion. Este modulo, del
 * > lado del servidor, **no emite** folios: los **valida** y deja que el unique
 * > de la base detecte las colisiones.
 *
 * > [!warning] Provisional: el segmento de vendedor
 * > Que hacer cuando dos vendedores comparten iniciales sigue **pendiente de
 * > confirmar con el cliente** (ver [[Vendedor]] y ADR-0007). Este modulo no
 * > decide el segmento: comprueba que el que llego sea el que el servidor tiene
 * > pinado en `vendedor.folio_segmento`.
 */

/** Los 12 caracteres, en 6 segmentos de 2. */
export const RE_FOLIO = /^[A-Z]{2}[0-9]{6}[A-Z]{2}[0-9]{2}$/;

/** Largo total del folio. Es una constante del formato, no un detalle. */
export const LARGO_FOLIO = 12;

/**
 * El consecutivo son 2 digitos, asi que un vendedor no puede pasar de 99
 * operaciones en un dia. ADR-0001 lo registra como consecuencia aceptada
 * ("suficiente hoy; vigilar a futuro"), no como un descuido.
 */
export const MAX_OPERACIONES_POR_DIA = 99;

export interface FolioPartido {
  sucursal: string;
  /** Ano de 2 digitos, tal como viaja en el folio. */
  anio: string;
  mes: string;
  dia: string;
  vendedor: string;
  /** El consecutivo del dia, ya como numero. */
  consecutivo: number;
  /** La fecha del folio como `AAAA-MM-DD`. Ver la nota sobre el siglo. */
  fecha: string;
}

/**
 * Parte un folio en sus 6 segmentos, o `null` si no tiene la forma del ADR.
 *
 * **El siglo se asume 20xx.** El folio solo lleva 2 digitos de ano, asi que no
 * hay de donde sacarlo; es el formato que el cliente confirmo y no se le anade
 * informacion que no tiene. La ambiguedad es real pero esta a 74 anos.
 */
export function partirFolio(folio: string): FolioPartido | null {
  if (!RE_FOLIO.test(folio)) return null;

  const anio = folio.slice(2, 4);
  const mes = folio.slice(4, 6);
  const dia = folio.slice(6, 8);
  const fecha = `20${anio}-${mes}-${dia}`;

  // Un folio bien formado puede seguir trayendo una fecha imposible
  // (`TJ261332AP01`). Se comprueba que la fecha exista de verdad y no solo que
  // sean digitos: el folio se cotejara contra una nota fisica fechada.
  const comprobacion = new Date(`${fecha}T00:00:00Z`);
  if (
    Number.isNaN(comprobacion.getTime()) ||
    comprobacion.toISOString().slice(0, 10) !== fecha
  ) {
    return null;
  }

  return {
    sucursal: folio.slice(0, 2),
    anio,
    mes,
    dia,
    vendedor: folio.slice(8, 10),
    consecutivo: Number(folio.slice(10, 12)),
    fecha,
  };
}

/**
 * Arma un folio a partir de sus piezas. Es la operacion inversa de
 * {@link partirFolio}.
 *
 * El servidor **no emite** folios (los emite la tablet, offline), pero necesita
 * poder construirlos para las pruebas y para que la unica definicion del
 * formato sea esta.
 */
export function formarFolio(
  sucursal: string,
  fecha: string,
  vendedor: string,
  consecutivo: number,
): string {
  const [anio, mes, dia] = fecha.split('-');
  return (
    sucursal.toUpperCase() +
    anio.slice(2) +
    mes +
    dia +
    vendedor.toUpperCase() +
    `${consecutivo}`.padStart(2, '0')
  );
}

export type MotivoFolioInvalido =
  | { causa: 'formato' }
  | { causa: 'sucursal'; esperada: string; recibida: string }
  | { causa: 'fecha'; esperada: string; recibida: string }
  | { causa: 'vendedor'; esperada: string | null; recibida: string };

/**
 * ¿Es este folio coherente con la operacion que lo trae?
 *
 * No basta con que tenga la forma correcta. El folio **repite** informacion que
 * la operacion ya trae por otro lado (sucursal, dia de trabajo y vendedor), y
 * si las dos versiones no coinciden alguien esta mintiendo o hay un bug en la
 * tablet. Dejarlo pasar produciria folios que no se pueden cotejar contra la
 * nota fisica, y **un folio emitido no se corrige hacia atras**.
 *
 * Los tres segmentos que se comprueban son justo los que el servidor conoce por
 * su cuenta:
 *
 * - **sucursal** — la del vendedor del token, no la que diga el cuerpo (T-09).
 * - **fecha** — `fecha_operacion`, el dia de trabajo que calculo la tablet con
 *   su reloj local. El servidor **no la re-deriva** de UTC (T-07); aqui solo
 *   comprueba que el folio diga lo mismo que el campo.
 * - **vendedor** — el segmento pinado en `vendedor.folio_segmento`. Esto es lo
 *   que impide que una tablet se invente las iniciales por su cuenta en vez de
 *   usar las que el servidor le mando en el `pull`.
 */
export function revisarFolio(
  folio: string,
  esperado: {
    sucursal: string;
    fechaOperacion: string;
    segmentoVendedor: string | null;
  },
): MotivoFolioInvalido | null {
  const partes = partirFolio(folio);
  if (partes === null) return { causa: 'formato' };

  if (partes.sucursal !== esperado.sucursal) {
    return {
      causa: 'sucursal',
      esperada: esperado.sucursal,
      recibida: partes.sucursal,
    };
  }

  if (partes.fecha !== esperado.fechaOperacion) {
    return {
      causa: 'fecha',
      esperada: esperado.fechaOperacion,
      recibida: partes.fecha,
    };
  }

  if (partes.vendedor !== esperado.segmentoVendedor) {
    return {
      causa: 'vendedor',
      esperada: esperado.segmentoVendedor,
      recibida: partes.vendedor,
    };
  }

  return null;
}

/** El motivo, en el espanol que va a leer quien tenga la tablet en la mano. */
export function explicarFolioInvalido(motivo: MotivoFolioInvalido): string {
  switch (motivo.causa) {
    case 'formato':
      return `El folio no tiene el formato de ${LARGO_FOLIO} caracteres en 6 segmentos (p. ej. TJ260322AP05).`;
    case 'sucursal':
      return `El folio dice sucursal ${motivo.recibida} y esta operacion es de ${motivo.esperada}.`;
    case 'fecha':
      return `El folio dice ${motivo.recibida} y fecha_operacion dice ${motivo.esperada}.`;
    case 'vendedor':
      return motivo.esperada === null
        ? `El folio trae el segmento de vendedor ${motivo.recibida}, pero este vendedor no tiene segmento de folio asignado.`
        : `El folio dice vendedor ${motivo.recibida} y el de este vendedor es ${motivo.esperada}.`;
  }
}
