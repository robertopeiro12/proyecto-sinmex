/**
 * `leerPapel` / `guardarPapel` sobre `expo-secure-store` (ver `preferencia.ts`).
 * No es un secreto; se usa porque ya esta instalado y guarda pares clave-valor
 * que sobreviven a cerrar la app, sin agregar otra dependencia nativa.
 */
import * as SecureStore from 'expo-secure-store';

import { crearPreferenciaPapel } from './preferencia';

export const { leerPapel, guardarPapel } = crearPreferenciaPapel({
  leer: (clave) => SecureStore.getItemAsync(clave),
  escribir: (clave, valor) => SecureStore.setItemAsync(clave, valor),
});
