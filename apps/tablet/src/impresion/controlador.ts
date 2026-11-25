/**
 * Controladores de la impresora de notas (rediseno piezas 7 y 7b).
 *
 * - **Bluetooth** (`crearControladorBluetooth`, pieza 7b): manda los bytes
 *   ESC/POS (`ticketsAEscPos`) directo a la termica emparejada, por el modulo
 *   nativo `ImpresoraBluetooth` (inyectado como `PuenteImpresora` para poder
 *   probarlo sin `expo`). `ok` aqui si quiere decir "la impresora recibio todo".
 * - **Dialogo de Android** (`crearControladorExpoPrint`, pieza 7): arma el HTML
 *   (`renglonesAHtml`) y abre el dialogo de impresion de Android, que usa la
 *   impresora configurada en el sistema (otra impresora o PDF).
 *
 * `elegirControlador` toma la impresora guardada en "Seleccionar impresora".
 *
 * > [!warning] En Android, `ok` quiere decir "se abrio el dialogo"
 * > `Print.printAsync` se resuelve en cuanto Android muestra su dialogo, no
 * > cuando sale el papel; si el vendedor cancela ahi, la app no se entera
 * > (`PrintModule.kt` de expo-print 57). `cancelada` solo llega cuando el
 * > sistema lo reporta (iOS: "Printing did not complete").
 *
 * El de expo-print no tiene prueba unitaria (es nativo); lo probado es
 * `html.ts`. El de Bluetooth se prueba con un puente falso.
 *
 * `expo-print` se carga **dentro** del `try`: su modulo nativo (`ExpoPrint`)
 * truena al evaluarse si la app instalada se compilo antes de esta pieza (un
 * dev client con el JS nuevo). Asi una pantalla que imprime no se cae: la
 * impresion sale como `fallo`.
 */
import { aBase64 } from './base64';
import { codigoDeError, SIN_IMPRESORA, textoErrorImpresora } from './errores-impresora';
import { ticketsAEscPos } from './escpos';
import { ticketsAHtml, type Papel } from './html';
import type { ImpresoraElegida } from './preferencia';

export type ResultadoImpresion = { ok: true } | { ok: false; motivo: 'cancelada' | 'fallo'; detalle?: string };

export interface ControladorImpresion {
  /** Un ticket. */
  imprimir(renglones: string[]): Promise<ResultadoImpresion>;
  /** Varios tickets en un solo trabajo, con salto de pagina entre ellos. */
  imprimirVarios(tickets: string[][]): Promise<ResultadoImpresion>;
}

export function crearControladorExpoPrint(papel: Papel): ControladorImpresion {
  const imprimirVarios = async (tickets: string[][]): Promise<ResultadoImpresion> => {
    try {
      const Print = await import('expo-print');
      await Print.printAsync({ html: ticketsAHtml(tickets, papel) });
      return { ok: true };
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      const motivo = /cancel|did not complete/i.test(detalle) ? 'cancelada' : 'fallo';
      return { ok: false, motivo, detalle };
    }
  };
  return {
    imprimir: (renglones) => imprimirVarios([renglones]),
    imprimirVarios,
  };
}

/** Lo que el controlador Bluetooth necesita del modulo nativo (ver `puente-bluetooth.ts`). */
export interface PuenteImpresora {
  /** Rechaza con un error con `code` del modulo (`CodigoErrorImpresora`). */
  imprimir(direccion: string, bytesBase64: string): Promise<void>;
}

/**
 * Todos los tickets van en **un solo** envio (una conexion RFCOMM): la termica
 * los saca seguidos, con avance de papel entre ellos.
 */
export function crearControladorBluetooth(
  direccion: string,
  nombre: string,
  puente: PuenteImpresora,
): ControladorImpresion {
  const imprimirVarios = async (tickets: string[][]): Promise<ResultadoImpresion> => {
    try {
      await puente.imprimir(direccion, aBase64(ticketsAEscPos(tickets)));
      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: 'fallo', detalle: textoErrorImpresora(codigoDeError(e), nombre) };
    }
  };
  return {
    imprimir: (renglones) => imprimirVarios([renglones]),
    imprimirVarios,
  };
}

/** Sin impresora elegida no se imprime: se dice donde elegirla. */
const SIN_ELEGIR: ControladorImpresion = {
  imprimir: async () => ({ ok: false, motivo: 'fallo', detalle: SIN_IMPRESORA }),
  imprimirVarios: async () => ({ ok: false, motivo: 'fallo', detalle: SIN_IMPRESORA }),
};

export function elegirControlador(
  impresora: ImpresoraElegida | null,
  papel: Papel,
  puente: PuenteImpresora,
): ControladorImpresion {
  if (impresora === null) return SIN_ELEGIR;
  if (impresora.tipo === 'dialogo') return crearControladorExpoPrint(papel);
  return crearControladorBluetooth(impresora.direccion, impresora.nombre, puente);
}
