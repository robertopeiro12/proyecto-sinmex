import { useCallback, useEffect, useState } from 'react';

import { crearControladorExpoPrint, type ResultadoImpresion } from './controlador';
import { imprimirEnOrden } from './datos-ticket';
import { COLUMNAS, type Papel } from './html';
import { guardarPapel, leerPapel } from './preferencia-expo';
import { armarTicket, type DatosTicket } from './ticket';

/**
 * Junta la preferencia de papel y el controlador.
 *
 * `imprimirTicket` relee el papel guardado en cada impresion en vez de usar el
 * estado del hook: otra pantalla (la venta) no ve el cambio hecho en
 * "Seleccionar impresora", y una impresion antes de la primera lectura usaria
 * 58 en silencio.
 */
export function useImpresion() {
  const [papel, setPapel] = useState<Papel | null>(null);

  useEffect(() => {
    let vivo = true;
    void leerPapel().then((p) => {
      if (vivo) setPapel(p);
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

  const imprimirTicket = useCallback(async (d: DatosTicket): Promise<ResultadoImpresion> => {
    try {
      const p = await leerPapel();
      return await crearControladorExpoPrint(p).imprimir(armarTicket(d, COLUMNAS[p]));
    } catch (e) {
      return { ok: false, motivo: 'fallo', detalle: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  /** Varias notas, una tras otra; `true` solo si salieron todas (ver `imprimirEnOrden`). */
  const imprimirTickets = useCallback(
    (tickets: (DatosTicket | null)[]) => imprimirEnOrden(imprimirTicket, tickets),
    [imprimirTicket],
  );

  /** `null` mientras se lee la preferencia. */
  return { papel, elegirPapel, imprimirTicket, imprimirTickets };
}
