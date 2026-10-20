import type { FuenteOperaciones } from './motor';
import { fuenteCobranzas } from './fuente-cobranzas';
import { fuenteGastos } from './fuente-gastos';
import { fuenteJornadas } from './fuente-jornadas';
import { fuenteProspectos } from './fuente-prospectos';
import { fuenteRutas } from './fuente-rutas';
import { fuenteVentas } from './fuente-ventas';
import { fuenteVisitas } from './fuente-visitas';
import type { FuentesConPendientes } from './pendientes';

/**
 * Las fuentes del push, **en el orden en que suben**. Cada fuente manda sus
 * lotes en requests separados, asi que el orden de esta lista es el orden en
 * que el servidor ve las cosas.
 *
 * - Jornadas primero (T-16): las ventas del dia suben despues de la jornada.
 * - **Prospectos antes que ventas (T-75, D3)**: el servidor comprueba el
 *   alcance de los clientes UNA vez por lote, antes de aplicar nada. La venta
 *   de bienvenida a un prospecto capturado sin red apunta a un cliente que
 *   solo existe cuando su alta ya entro; si fuera en el mismo lote o antes,
 *   caeria `cliente-fuera-de-alcance` y entraria hasta la siguiente
 *   sincronizacion.
 * - Cobranzas despues de ventas (T-20): nunca antes que una venta del dia.
 * - Visitas despues de cobranzas (T-39): la visita a un prospecto capturado sin red necesita
 *   su alta ya aplicada (el alcance se comprueba una vez por lote, como la venta de bienvenida de T-75).
 * - Gastos despues de visitas (T-30/T-31, D5): no dependen de ningun cliente;
 *   van antes de las altas de ruta para que el orden del spec quede fijo.
 * - Altas de ruta (T-37) no dependen de nadie: al final.
 *
 * Vive aqui y no en `proveedor-sesion.tsx` para que el orden tenga prueba.
 */
export function fuentesDelPush(datos: FuentesConPendientes): FuenteOperaciones[] {
  return [
    fuenteJornadas(datos.jornadas),
    fuenteProspectos(datos.prospectos),
    fuenteVentas(datos.ventas),
    fuenteCobranzas(datos.cobranzas),
    fuenteVisitas(datos.visitas),
    fuenteGastos(datos.gastos),
    fuenteRutas(datos.rutas),
  ];
}
