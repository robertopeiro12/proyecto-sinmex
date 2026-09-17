import type { RepositorioJornadas } from '@/datos/repositorios/jornadas';
import type { RepositorioProspectos } from '@/datos/repositorios/prospectos';
import type { RepositorioVentas } from '@/datos/repositorios/ventas';

/**
 * Las fuentes del push cuyos pendientes cuentan como "registros por subir".
 *
 * Un subconjunto de `CapaDatos` (`@/datos/inicializar`) en vez del objeto
 * completo: asi la prueba en Node arma solo estos 3 repositorios, sin pasar
 * por `inicializarCapaDatos()` (que abre SQLite con el driver de Expo). El
 * tipo no obliga a nadie a nada — si T-20 agrega una cuarta fuente al push, la
 * disciplina de sumarla **aqui**, en el unico lugar que cuenta, sigue siendo
 * manual.
 */
export interface FuentesConPendientes {
  jornadas: RepositorioJornadas;
  ventas: RepositorioVentas;
  prospectos: RepositorioProspectos;
}

/**
 * Cuenta lo que falta por subir, sumando las 3 fuentes del push de hoy (T-07,
 * T-16, T-40): jornada, venta y prospecto.
 *
 * Si una fuente se queda fuera de esta suma, el menu de la jornada y "cerrar
 * el dia" pueden decir "listo" con datos todavia sin subir (I-1, PR #90) — por
 * eso vive en una sola funcion que usan las dos pantallas, en vez de que cada
 * una repita (y arriesgue olvidar) la lista de fuentes.
 */
export function contarPendientesDeSubir(datos: FuentesConPendientes): number {
  return (
    datos.jornadas.pendientesDeSincronizar().length +
    datos.ventas.pendientesDeSincronizar().length +
    datos.prospectos.pendientesDeSincronizar().length
  );
}
