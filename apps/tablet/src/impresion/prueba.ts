import type { Reloj } from '@/datos/reloj';

import type { DatosTicket } from './ticket';

/**
 * La nota de "Imprimir prueba" en "Seleccionar impresora": datos de ejemplo con
 * nombres largos, acentos, una promocion y un abono, para ver de un vistazo si
 * el papel elegido corta o desalinea algo.
 *
 * El abono lleva el dia de **Tijuana** (`reloj.hoy()`), no el de UTC: despues
 * de las 17:00 el UTC ya es manana.
 */
export function ticketDePrueba(reloj: Reloj, vendedor = 'Vendedor de prueba'): DatosTicket {
  const momento = reloj.ahora();
  return {
    sucursal: 'Prueba de impresión',
    folio: 'PRUEBA',
    momento,
    cliente: 'Tienda Doña Chuy',
    atendio: 'María de Jesús Ramos',
    vendedor,
    renglones: [
      { cantidad: 12, etiqueta: 'Jamaica 500 ml', precioCentavos: 1800, importeCentavos: 21600 },
      { cantidad: 6, etiqueta: 'Horchata 1 L', precioCentavos: 3200, importeCentavos: 19200 },
      { cantidad: 12, etiqueta: 'Mango 500 ml', precioCentavos: 2400, importeCentavos: 28800 },
    ],
    promociones: [{ cantidad: 2, etiqueta: 'Mango 500 ml', texto: 'Por cada 6 Mango 500 ml, 1 Mango 500 ml gratis' }],
    totalCentavos: 69600,
    abonos: [{ fecha: reloj.hoy(), montoCentavos: 30000 }],
    saldoCentavos: 39600,
    reimpresion: null,
    detalleDisponible: true,
  };
}
