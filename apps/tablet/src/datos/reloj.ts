/**
 * Reloj inyectable.
 *
 * La capa de datos nunca llama a `new Date()` directamente: la fecha decide el
 * corte de la jornada y el reinicio del contador de folios (ver
 * [[ADR-0001 Formato de folios]]), asi que tiene que poder fijarse en pruebas.
 */
export interface Reloj {
  /** Timestamp ISO-8601 completo. */
  ahora(): string;
  /** Fecha `AAAA-MM-DD` local de la tablet. */
  hoy(): string;
}

/**
 * Reloj real. `hoy()` usa la fecha **local** del dispositivo, no UTC: la
 * jornada del vendedor termina cuando termina su dia en Tijuana, y en UTC eso
 * ya seria el dia siguiente.
 */
export const relojSistema: Reloj = {
  ahora: () => new Date().toISOString(),
  hoy: () => {
    const d = new Date();
    const mes = `${d.getMonth() + 1}`.padStart(2, '0');
    const dia = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  },
};

/** Reloj fijo para pruebas. */
export function relojFijo(momento: string): Reloj {
  return { ahora: () => momento, hoy: () => momento.slice(0, 10) };
}
