/**
 * Nucleo de permisos: puro, sin base de datos y sin Nest.
 *
 * Vive separado de PermisosRepository a proposito. La precedencia entre el
 * perfil y las excepciones por usuario es la unica parte que se puede razonar
 * mal; el acceso a datos no tiene reglas. Separandolos, la regla se prueba con
 * pruebas unitarias que corren en milisegundos, sin Postgres. Mismo patron que
 * alcance-sucursal.ts en T-09.
 */

/**
 * El perfil "usuario maestro" sembrado en T-05. Quien lo tiene recibe el
 * catalogo COMPLETO de permisos (ver D1 del spec).
 *
 * La comparacion es por igualdad exacta, no por prefijo: 'Administrador' es
 * otro perfil de la misma semilla, y un `startsWith` le regalaria acceso total.
 */
export const PERFIL_MAESTRO = 'Administrador General';

export function esMaestro(perfil: string): boolean {
  return perfil === PERFIL_MAESTRO;
}

/** Una fila de `usuario_permiso`: `habilitado` concede (true) o quita (false). */
export interface Excepcion {
  clave: string;
  habilitado: boolean;
}

/**
 * Permisos efectivos = los del perfil, con las excepciones del usuario
 * aplicadas encima. La excepcion SIEMPRE gana sobre el perfil, en los dos
 * sentidos (D3): el negocio pide tanto "a este usuario dale un permiso extra"
 * como "a este quitaselo", y la tabla de T-05 ya soporta ambos.
 */
export function combinarPermisos(
  delPerfil: string[],
  excepciones: Excepcion[],
): Set<string> {
  const efectivos = new Set(delPerfil);
  for (const { clave, habilitado } of excepciones) {
    if (habilitado) {
      efectivos.add(clave);
    } else {
      efectivos.delete(clave);
    }
  }
  return efectivos;
}
