/**
 * `leerPapel` / `guardarPapel` y `leerImpresora` / `guardarImpresora` sobre
 * `expo-secure-store` (ver `preferencia.ts`). No es un secreto; se usa porque
 * ya esta instalado y guarda pares clave-valor que sobreviven a cerrar la app,
 * sin agregar otra dependencia nativa.
 */
import * as SecureStore from 'expo-secure-store';

import { crearPreferenciaImpresora, crearPreferenciaPapel, type AlmacenPreferencia } from './preferencia';

const almacen: AlmacenPreferencia = {
  leer: (clave) => SecureStore.getItemAsync(clave),
  escribir: (clave, valor) => SecureStore.setItemAsync(clave, valor),
};

export const { leerPapel, guardarPapel } = crearPreferenciaPapel(almacen);
export const { leerImpresora, guardarImpresora } = crearPreferenciaImpresora(almacen);
