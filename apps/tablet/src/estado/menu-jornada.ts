import type { Jornada } from '@/datos/tipos';

/**
 * Lo que el menu de la jornada muestra segun el estado del dia (T-38, D6).
 *
 * Puro y fuera de la pantalla a proposito: la tablet no tiene pruebas de
 * componentes (ver `jest.config.js`), y esta es la decision que vale la pena
 * fijar con una prueba.
 */
export interface EstadoMenuJornada {
  /** *Operación por cliente*, *Prospectos* y *Ruta y GPS*. */
  operacionesHabilitadas: boolean;
  /** Texto de la tarjeta "Día cerrado", o `null` si el día sigue abierto. */
  avisoDiaCerrado: string | null;
}

/**
 * Con la jornada cerrada, las secciones que capturan quedan deshabilitadas: no
 * hay reabrir, y la capa de datos las rechazaria de todos modos
 * (`exigirJornadaAbierta`). *Cerrar el día* y *Sincronizar ahora* no se tocan:
 * el resumen se sigue viendo y lo capturado tiene que poder subir.
 */
export function estadoMenuJornada(
  jornada: Pick<Jornada, 'estado' | 'km_final'> | null,
): EstadoMenuJornada {
  if (jornada?.estado !== 'cerrada') {
    return { operacionesHabilitadas: true, avisoDiaCerrado: null };
  }
  return {
    operacionesHabilitadas: false,
    avisoDiaCerrado: `Día cerrado · km final ${jornada.km_final ?? 0} · lo capturado sube con «Sincronizar ahora»`,
  };
}

/** El texto de la confirmación antes de cerrar el día (D6 capa 1). */
export function textoConfirmarCierre(kmFinal: number): string {
  return `Después de cerrar el día ya no podrás vender, cobrar ni registrar prospectos en esta tablet. ¿Cerrar el día con km final ${kmFinal}?`;
}
