/**
 * Puente JS del módulo nativo `ImpresoraBluetooth` (Kotlin, solo Android):
 * lista las impresoras emparejadas y manda bytes ESC/POS por RFCOMM/SPP.
 *
 * El módulo es opcional: en un APK viejo o en iOS no existe y `disponible()`
 * da `false`; las otras funciones rechazan con `sin-bluetooth`. Este archivo
 * importa `expo`, que el Jest de ts-jest/node no carga: las pruebas deben
 * sustituirlo (mock o interfaz inyectada), no importarlo.
 * Antes de llamar, el JS debe pedir `BLUETOOTH_CONNECT` (API 31+); si falta, el
 * nativo rechaza con `sin-permiso`.
 */
import { requireOptionalNativeModule } from 'expo';

import type {
  CodigoErrorImpresora,
  ImpresoraEmparejada,
  ModuloImpresoraBluetooth,
} from './src/ImpresoraBluetooth.types';

export type { CodigoErrorImpresora, ImpresoraEmparejada };

const nativo = requireOptionalNativeModule<ModuloImpresoraBluetooth>('ImpresoraBluetooth');

function sinModulo(): Error & { code: CodigoErrorImpresora } {
  return Object.assign(new Error('El módulo de impresora Bluetooth no está en este APK'), {
    code: 'sin-bluetooth' as const,
  });
}

export function disponible(): boolean {
  return nativo != null;
}

export async function emparejadas(): Promise<ImpresoraEmparejada[]> {
  if (!nativo) throw sinModulo();
  return nativo.emparejadas();
}

/** `bytesBase64`: los bytes ESC/POS en base64 (ver `aBase64`). */
export async function imprimir(direccion: string, bytesBase64: string): Promise<void> {
  if (!nativo) throw sinModulo();
  return nativo.imprimir(direccion, bytesBase64);
}
