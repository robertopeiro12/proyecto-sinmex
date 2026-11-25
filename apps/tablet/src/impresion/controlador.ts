/**
 * Controlador de la impresora de notas (rediseno pieza 7).
 *
 * La interfaz deja la puerta abierta a un controlador ESC/POS directo por
 * Bluetooth; el de hoy es `expo-print`: arma el HTML (`renglonesAHtml`) y abre
 * el **dialogo de impresion de Android**, que usa la impresora configurada en
 * el sistema (el servicio de impresion del fabricante de la termica).
 *
 * > [!warning] En Android, `ok` quiere decir "se abrio el dialogo"
 * > `Print.printAsync` se resuelve en cuanto Android muestra su dialogo, no
 * > cuando sale el papel; si el vendedor cancela ahi, la app no se entera
 * > (`PrintModule.kt` de expo-print 57). `cancelada` solo llega cuando el
 * > sistema lo reporta (iOS: "Printing did not complete").
 *
 * Delgado a proposito: no tiene prueba unitaria (es nativo). Lo probado es
 * `html.ts` y `preferencia.ts`.
 */
import * as Print from 'expo-print';

import { renglonesAHtml, type Papel } from './html';

export type ResultadoImpresion = { ok: true } | { ok: false; motivo: 'cancelada' | 'fallo'; detalle?: string };

export interface ControladorImpresion {
  imprimir(renglones: string[]): Promise<ResultadoImpresion>;
}

export function crearControladorExpoPrint(papel: Papel): ControladorImpresion {
  return {
    async imprimir(renglones) {
      try {
        await Print.printAsync({ html: renglonesAHtml(renglones, papel) });
        return { ok: true };
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e);
        const motivo = /cancel|did not complete/i.test(detalle) ? 'cancelada' : 'fallo';
        return { ok: false, motivo, detalle };
      }
    },
  };
}
