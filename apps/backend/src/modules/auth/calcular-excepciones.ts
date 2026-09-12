import type { Excepcion } from './permisos';

/**
 * Inversa de `combinarPermisos` (permisos.ts): esa funcion aplica el perfil +
 * las excepciones para llegar a los permisos EFECTIVOS; esta parte de los
 * permisos efectivos que el administrador acaba de marcar en el formulario
 * (D3 del spec -- "estado final marcado", no una lista de excepciones) y
 * calcula que filas de `usuario_permiso` hacen falta para reproducirlos.
 *
 * Una clave es una excepcion cuando NO coincide con lo que el perfil ya da:
 * marcada + el perfil no la da -> habilitado: true (la excepcion la concede).
 * desmarcada + el perfil si la da -> habilitado: false (la excepcion la quita).
 * En cualquier otro caso coincide con el perfil y no aparece en el resultado
 * -- si antes existia una excepcion ahi, quien llama debe borrarla (no es
 * responsabilidad de esta funcion pura, que no conoce el estado guardado).
 */
export function calcularExcepciones(
  marcados: Set<string>,
  delPerfil: string[],
): Excepcion[] {
  const delPerfilSet = new Set(delPerfil);
  const todasLasClaves = new Set([...marcados, ...delPerfilSet]);
  const excepciones: Excepcion[] = [];

  for (const clave of todasLasClaves) {
    const marcado = marcados.has(clave);
    const enPerfil = delPerfilSet.has(clave);
    if (marcado !== enPerfil) {
      excepciones.push({ clave, habilitado: marcado });
    }
  }

  return excepciones;
}
