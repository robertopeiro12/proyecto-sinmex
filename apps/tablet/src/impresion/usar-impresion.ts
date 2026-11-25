import { useCallback, useEffect, useState } from 'react';

import { elegirControlador, type ControladorImpresion, type ResultadoImpresion } from './controlador';
import { imprimirJuntos } from './datos-ticket';
import { COLUMNAS, type Papel } from './html';
import type { ImpresoraElegida } from './preferencia';
import { guardarImpresora, guardarPapel, leerImpresora, leerPapel } from './preferencia-expo';
import { puenteBluetooth } from './puente-bluetooth';
import { armarTicket, type DatosTicket } from './ticket';

/** El controlador de la impresora y el papel guardados **ahora** (ver `useImpresion`). */
async function controladorGuardado(): Promise<{ controlador: ControladorImpresion; papel: Papel }> {
  const [papel, impresora] = await Promise.all([leerPapel(), leerImpresora()]);
  return { controlador: elegirControlador(impresora, papel, puenteBluetooth), papel };
}

/**
 * Junta las preferencias (papel e impresora elegida) y el controlador.
 *
 * Imprimir relee lo guardado en cada impresion en vez de usar el estado del
 * hook: otra pantalla (la venta) no ve el cambio hecho en "Seleccionar
 * impresora", y una impresion antes de la primera lectura usaria otra cosa en
 * silencio. Sin impresora elegida sale `fallo` con "Elige la impresora en
 * Seleccionar impresora." (`elegirControlador`).
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
   * solo envio por Bluetooth, o un dialogo con salto de pagina entre ellas); `true` solo si salieron todas (ver
   * `imprimirJuntos`).
   */
  const imprimirTickets = useCallback(
    (tickets: (DatosTicket | null)[]) =>
      imprimirJuntos(async (ds) => {
        const { controlador, papel: p } = await controladorGuardado();
        return controlador.imprimirVarios(ds.map((d) => armarTicket(d, COLUMNAS[p])));
      }, tickets),
    [],
  );

  /** `papel`: `null` mientras se lee. `impresora`: `undefined` mientras se lee, `null` sin elegir. */
  return { papel, elegirPapel, impresora, elegirImpresora, imprimirTicket, imprimirTickets };
}
