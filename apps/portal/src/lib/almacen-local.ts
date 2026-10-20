/**
 * localStorage que nunca truena (UI Etapa 1, spec §3.3 y §3.5): en ventana privada,
 * con los datos del sitio bloqueados o en el render del servidor (sin `window`)
 * simplemente no se recuerda nada. Solo para comodidades de esta computadora
 * (qué secciones del menú están abiertas, si el menú está escondido).
 */
export function leerLocal(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

export function guardarLocal(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento: no se recuerda, y ya.
  }
}
