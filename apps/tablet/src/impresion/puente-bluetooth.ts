/**
 * El modulo nativo `ImpresoraBluetooth` con el permiso de Android delante.
 *
 * En API 31+ (Android 12) listar emparejadas y conectar piden
 * `BLUETOOTH_CONNECT` en tiempo de ejecucion; se pide antes de cada llamada
 * (si ya se dio, Android responde sin mostrar nada). Negado -> error
 * `sin-permiso`, igual que si lo rechazara el nativo.
 *
 * Separado de `controlador.ts` porque importa `react-native` y el modulo (que
 * trae `expo`): Jest (Node puro) no los carga.
 */
import { PermissionsAndroid, Platform } from 'react-native';

import * as modulo from '../../modules/impresora-bluetooth';
import type { ImpresoraEmparejada } from '../../modules/impresora-bluetooth';

import type { PuenteImpresora } from './controlador';

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
  async emparejadas() {
    await pedirPermiso();
    return modulo.emparejadas();
  },
  async imprimir(direccion, bytesBase64) {
    await pedirPermiso();
    return modulo.imprimir(direccion, bytesBase64);
  },
};
