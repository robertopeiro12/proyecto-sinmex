import { useCallback, useEffect, useState } from 'react';

import {
  controladorAUsar,
  elegirControlador,
  type ControladorImpresion,
  type ResultadoImpresion,
} from './controlador';
import { imprimirJuntos } from './datos-ticket';
import { COLUMNAS, type Papel } from './html';
import type { ImpresoraElegida } from './preferencia';
import { guardarImpresora, guardarPapel, leerImpresora, leerPapel } from './preferencia-expo';
import { puenteBluetooth } from './puente-bluetooth';
import { armarTicket, type DatosTicket } from './ticket';

/** El controlador de la impresora y el papel guardados **ahora** (ver `useImpresion`). */
async function controladorGuardado(): Promise<{
  controlador: ControladorImpresion;
  papel: Papel;
  esDialogo: boolean;
}> {
  const [papel, impresora] = await Promise.all([leerPapel(), leerImpresora()]);
  const modulo = puenteBluetooth.disponible();
  return {
    controlador: elegirControlador(impresora, papel, puenteBluetooth, modulo),
    papel,
    esDialogo: controladorAUsar(impresora, modulo) === 'dialogo',
  };
}

/**
 * Junta las preferencias (papel e impresora elegida) y el controlador.
 *
 * Imprimir relee lo guardado en cada impresion en vez de usar el estado del
 * hook: otra pantalla (la venta) no ve el cambio hecho en "Seleccionar
 * impresora", y una impresion antes de la primera lectura usaria otra cosa en
 * silencio. Sin impresora elegida sale `fallo` con "Elige la impresora en
 * Seleccionar impresora."; si el APK no trae el modulo Bluetooth, se usa el
 * dialogo de Android (`controladorAUsar`).
 */
export function useImpresion() {
  const [papel, setPapel] = useState<Papel | null>(null);
  /** `undefined` mientras se lee; `null` = aun no se elige. */
  const [impresora, setImpresora] = useState<ImpresoraElegida | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    void leerPapel().then((p) => {
      if (vivo) setPapel(p);
    });
    void leerImpresora().then((i) => {
      if (vivo) setImpresora(i);
    });
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * Guarda primero y solo entonces pinta el papel nuevo: si guardar falla, la
   * pantalla sigue mostrando el que de verdad se usara al imprimir (el guardado).
   * Lanza el error para que la pantalla avise.
   */
  const elegirPapel = useCallback(async (p: Papel) => {
    await guardarPapel(p);
    setPapel(p);
  }, []);

  /** Igual que `elegirPapel`: guarda primero, pinta despues, lanza si no se pudo guardar. */
  const elegirImpresora = useCallback(async (i: ImpresoraElegida) => {
    await guardarImpresora(i);
    setImpresora(i);
  }, []);

  const imprimirTicket = useCallback(async (d: DatosTicket): Promise<ResultadoImpresion> => {
    try {
      const { controlador, papel: p } = await controladorGuardado();
      return await controlador.imprimir(armarTicket(d, COLUMNAS[p]));
    } catch (e) {
      return { ok: false, motivo: 'fallo', detalle: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  /**
   * Varias notas (las de un cobro) en **un solo** trabajo de impresion (un
   * solo envio por Bluetooth, o un dialogo con salto de pagina entre ellas);
   * `ok` solo si salieron todas (ver `imprimirJuntos`). El `detalle` de un
   * fallo es el texto para el vendedor (Bluetooth o sin elegir); el del dialogo
   * es el mensaje crudo de Android y no se pasa al aviso.
   */
  const imprimirTickets = useCallback(
    (tickets: (DatosTicket | null)[]) =>
      imprimirJuntos(async (ds) => {
        const { controlador, papel: p, esDialogo } = await controladorGuardado();
        const r = await controlador.imprimirVarios(ds.map((d) => armarTicket(d, COLUMNAS[p])));
        return r.ok || !esDialogo ? r : { ok: false };
      }, tickets),
    [],
  );

  /** `papel`: `null` mientras se lee. `impresora`: `undefined` mientras se lee, `null` sin elegir. */
  return { papel, elegirPapel, impresora, elegirImpresora, imprimirTicket, imprimirTickets };
}
