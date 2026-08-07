/**
 * Implementacion real de {@link AlmacenSeguro} sobre `expo-secure-store`.
 *
 * Vive en su propio archivo (y no junto a la interfaz) por la misma razon que
 * `driver-expo.ts` esta separado de `driver-node.ts`: importar
 * `expo-secure-store` desde el modulo que usan las pruebas arrastraria un
 * modulo nativo a Node y no habria forma de probar la logica de sesion sin
 * dispositivo.
 *
 * En Android los valores se guardan cifrados con una clave del **Keystore**
 * del sistema, fuera del sandbox de archivos de la app. Eso es lo que hace que
 * un respaldo del dispositivo, o leer `/data` con el telefono apagado, no
 * entregue el verificador de la contrasena.
 */
import * as SecureStore from 'expo-secure-store';

import type { AlmacenSeguro } from './almacen';

export function almacenSecureStore(): AlmacenSeguro {
  return {
    leer(clave) {
      const valor = SecureStore.getItem(clave);
      // Una cadena vacia es el rastro que deja `borrar()` (ver abajo): se
      // trata como ausencia, no como una sesion vacia.
      return valor === null || valor === '' ? null : valor;
    },

    escribir(clave, valor) {
      SecureStore.setItem(clave, valor);
    },

    /**
     * Borrado en dos tiempos, y no es un rodeo innecesario.
     *
     * `expo-secure-store` solo ofrece `deleteItemAsync`. Si el borrado fuera
     * solo esa promesa, entre el "cerrar sesion" y su resolucion la sesion
     * seguiria siendo legible de forma sincrona — justo lo que lee el arranque
     * de la app. Asi que primero se **pisa el valor** de forma sincrona (a
     * partir de ahi `leer()` ya devuelve null) y despues se pide el borrado
     * real de la entrada.
     */
    borrar(clave) {
      SecureStore.setItem(clave, '');
      void SecureStore.deleteItemAsync(clave).catch(() => {
        // Si el borrado definitivo falla, la entrada queda en cadena vacia:
        // sin tokens y sin verificador. No hay nada que rescatar ni que
        // reintentar, y reventar aqui dejaria al vendedor sin poder salir.
      });
    },
  };
}
