/**
 * El modulo nativo `ImpresoraBluetooth` con el permiso de Android cuando falta.
 *
 * En API 31+ (Android 12) listar emparejadas y conectar piden
 * `BLUETOOTH_CONNECT` en tiempo de ejecucion. Se llama primero al nativo, que
 * revisa el adaptador **antes** que el permiso: un equipo sin Bluetooth (el
 * emulador) dice `sin-bluetooth` sin mostrarle al vendedor una ventana de
 * permiso inutil. Solo si el nativo responde `sin-permiso` se pide el permiso
 * y se reintenta una vez; negado -> `sin-permiso`.
 *
 * Separado de `controlador.ts` porque importa `react-native` y el modulo (que
 * trae `expo`): Jest (Node puro) no los carga.
 */
import { PermissionsAndroid, Platform } from 'react-native';

import * as modulo from '../../modules/impresora-bluetooth';
import type { ImpresoraEmparejada } from '../../modules/impresora-bluetooth';

import type { PuenteImpresora } from './controlador';
import { conPermiso } from './errores-impresora';

function sinPermiso(): Error & { code: 'sin-permiso' } {
  return Object.assign(new Error('Falta el permiso de Bluetooth'), { code: 'sin-permiso' as const });
}

async function pedirPermiso(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  if (r !== PermissionsAndroid.RESULTS.GRANTED) throw sinPermiso();
}

export const puenteBluetooth: PuenteImpresora & {
  /** `false` si el APK no trae el modulo (o no es Android). */
  disponible(): boolean;
  emparejadas(): Promise<ImpresoraEmparejada[]>;
} = {
  disponible: () => modulo.disponible(),
  emparejadas: () => conPermiso(() => modulo.emparejadas(), pedirPermiso),
  imprimir: (direccion, bytesBase64) => conPermiso(() => modulo.imprimir(direccion, bytesBase64), pedirPermiso),
};
