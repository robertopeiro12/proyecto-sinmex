import type { RechazoVenta } from './venta-rechazada';

/**
 * Reglas de una venta que no necesitan base de datos (T-16).
 *
 * Funciones puras por el mismo criterio que `normalizarOperacion` (T-07) y
 * `resolverAlcance` (T-09): son las que deciden, y tienen que poder probarse
 * enteras sin montar Postgres. Las usa `VentasService`, que sirve a la tablet
 * (push) y servira al portal (T-17) sin cambiar.
 */

export type ContadoCredito = 'contado' | 'credito';

/**
 * Los unicos status con los que una venta puede NACER. `abonado` y
 * `cuenta_perdida` existen en la columna pero nunca son iniciales: el primero
 * lo pone un abono (T-20) y el segundo solo se asigna al modificar
 * ([[Status de venta]]).
 */
export type StatusInicial = 'pagada' | 'pendiente' | 'promocion';

/**
 * Status con el que nace la venta (D4).
 *
 * El monto va primero: una venta que solo regala piezas vale $0 y es
 * `promocion` aunque se haya marcado de contado o de credito — no hay nada que
 * cobrar ni nada que deba entrar a cuentas por cobrar.
 */
export function statusInicial(
  contadoCredito: ContadoCredito,
  montoTotalCentavos: number,
): StatusInicial {
  if (montoTotalCentavos === 0) return 'promocion';
  return contadoCredito === 'contado' ? 'pagada' : 'pendiente';
}

/**
 * Monto de la venta en centavos: suma de cantidad x precio. Las piezas de
 * promocion **no suman** ([[Venta-Nota]]). Lo calcula el servidor; la tablet no
 * manda total (D14), asi que un total que no cuadra con sus lineas no puede
 * existir.
 */
export function montoTotalCentavos(
  lineas: readonly { cantidad: number; precioCentavos: number }[],
): number {
  return lineas.reduce((total, l) => total + l.cantidad * l.precioCentavos, 0);
}

/**
 * Semana ISO-8601 de una fecha `AAAA-MM-DD` (D6).
 *
 * Lunes a domingo, y la semana 1 es la que contiene el primer jueves del ano,
 * asi que los primeros dias de enero pueden ser la semana 52 o 53 del ano
 * anterior (`2027-01-01` es la 53 de 2026). La convencion esta **pendiente de
 * confirmar con el cliente**; la columna se puede recalcular.
 *
 * > [!danger] Se calcula de `fecha_operacion` TAL CUAL llego
 * > Nunca de `ocurrido_en` ni de `new Date(fecha)`: la cadena se parte a mano y
 * > se arma en UTC, asi que el huso horario del proceso no puede correr el dia.
 * > A las 18:00 de Tijuana en UTC ya es el dia siguiente.
 */
export function semanaISO(fecha: string): number {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const instante = new Date(Date.UTC(anio, mes - 1, dia));
  // El jueves de esa misma semana decide a que ano pertenece la semana.
  const diaSemana = instante.getUTCDay() || 7; // lunes = 1 ... domingo = 7
  instante.setUTCDate(instante.getUTCDate() + 4 - diaSemana);
  const inicioAnio = Date.UTC(instante.getUTCFullYear(), 0, 1);
  const diasDesdeInicio = (instante.getTime() - inicioAnio) / 86_400_000;
  return Math.ceil((diasDesdeInicio + 1) / 7);
}

/** Mes 1-12 de una fecha `AAAA-MM-DD`, leido del texto (ver `semanaISO`). */
export function mesDe(fecha: string): number {
  return Number(fecha.slice(5, 7));
}

/**
 * ¿Se pueden vender estas lineas a este cliente? (D12, D13)
 *
 * `precios` es lo que devuelve `PreciosRepository.presentacionesConPrecio()`:
 * una entrada por presentacion **vendible**, con su precio vigente en centavos
 * o `null` si el cliente no tiene ninguno.
 *
 * - Una presentacion que no esta en el mapa: `presentacion-inactiva`. Se revisa
 *   **antes** que el precio, en todas las lineas: si la presentacion ya no se
 *   vende, hablar de su precio seria una pista falsa.
 * - Una linea con cantidad > 0 sin precio: `precio-no-asignado`. Es una
 *   comprobacion de **existencia**, nunca de valor: el precio que manda la
 *   tablet no se compara con este (D2, vale el de la nota firmada).
 * - Una linea de pura promocion no necesita precio (D13).
 *
 * Devuelve el rechazo en vez de lanzar para poder probarse sola; quien llama
 * lanza `VentaRechazada`.
 */
export function revisarLineas(
  lineas: readonly { presentacionId: string; cantidad: number }[],
  precios: ReadonlyMap<string, number | null>,
): RechazoVenta | null {
  const inactiva = lineas.find((l) => !precios.has(l.presentacionId));
  if (inactiva) {
    return {
      razon: 'presentacion-inactiva',
      motivo: `La presentacion ${inactiva.presentacionId} no existe, esta dada de baja o su producto esta inactivo.`,
    };
  }

  const sinPrecio = lineas.find(
    (l) => l.cantidad > 0 && precios.get(l.presentacionId) === null,
  );
  if (sinPrecio) {
    return {
      razon: 'precio-no-asignado',
      motivo: `El cliente no tiene precio vigente para la presentacion ${sinPrecio.presentacionId}. Asignalo en el portal y vuelve a sincronizar.`,
    };
  }

  return null;
}
