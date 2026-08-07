/**
 * Donde vive la sesion del vendedor.
 *
 * > [!danger] Nunca en SQLite ni en AsyncStorage
 * > La base local (`jawa.db`) no esta cifrada: es un archivo que cualquier
 * > respaldo del dispositivo se lleva entero, y AsyncStorage es lo mismo con
 * > otro nombre. Los tokens y el verificador de la contrasena van al
 * > almacenamiento **cifrado por el sistema** (`expo-secure-store`, respaldado
 * > por el Keystore de Android). Ver `almacen-secure-store.ts`.
 *
 * Este archivo define solo la **interfaz** y una implementacion en memoria: asi
 * la logica de sesion se prueba en Node sin dispositivo, igual que la capa de
 * datos hace con `better-sqlite3` (ADR-0004).
 */

/** Clave unica bajo la que se guarda la sesion. */
export const CLAVE_SESION = 'jawa.sesion.vendedor';

/**
 * Almacenamiento clave-valor **sincrono**.
 *
 * Sincrono a proposito: todo el arranque de la app (T-04) lo es —
 * `inicializarCapaDatos()`, los `useState` con inicializador perezoso, los
 * `<Redirect>` inmediatos. Si leer la sesion fuera asincrono, la primera
 * pasada de `app/index.tsx` veria "no hay sesion" y mandaria al login incluso
 * cuando si la hay. `expo-secure-store` expone `getItem`/`setItem` sincronos
 * desde el SDK 57, asi que no hace falta pagar ese precio.
 */
export interface AlmacenSeguro {
  leer(clave: string): string | null;
  escribir(clave: string, valor: string): void;
  borrar(clave: string): void;
}

/** Implementacion en memoria, para pruebas. */
export function almacenMemoria(inicial: Record<string, string> = {}): AlmacenSeguro {
  const datos = new Map<string, string>(Object.entries(inicial));
  return {
    leer: (clave) => datos.get(clave) ?? null,
    escribir: (clave, valor) => {
      datos.set(clave, valor);
    },
    borrar: (clave) => {
      datos.delete(clave);
    },
  };
}
