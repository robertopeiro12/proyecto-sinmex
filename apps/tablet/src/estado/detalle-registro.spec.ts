import type { RenglonRegistro } from './registros';
import {
  datosDeLaVenta,
  datosDelCobro,
  datosDePago,
  destinoRenglon,
  encabezadoVenta,
  FILTROS_REGISTRO,
  mensajeRegistroVacio,
  notasDelCobro,
  quedoAFavor,
  renglonesDeVenta,
  textoResumenRegistro,
  textoSincronizada,
} from './detalle-registro';

/** "Etiqueta valor", como se lee en la pantalla. */
const leer = (datos: readonly { etiqueta: string; valor: string }[]) => datos.map((d) => `${d.etiqueta} ${d.valor}`);

describe('detalle de un movimiento (rediseño pieza 5, maqueta 18)', () => {
  it('registro: los cuatro filtros y la tarjeta de arriba', () => {
    expect(FILTROS_REGISTRO.map((f) => f.etiqueta)).toEqual(['Todo', 'Ventas del día', 'Cobranza', 'Notas pendientes']);
    expect(textoResumenRegistro('todo', 5)).toBe('Hoy · 5 movimientos');
    expect(textoResumenRegistro('cobranza', 1)).toBe('Hoy · 1 movimiento');
    expect(textoResumenRegistro('pendientes', 2)).toBe('Hoy · 2 notas por cobrar');
  });

  describe('Pagó / Quedó a crédito', () => {
    it('abonada: pagó el abono y quedó el resto (la maqueta)', () => {
      expect(
        leer(datosDePago({ contado_credito: 'credito', monto_total_centavos: 124000, abono_centavos: 30000 })),
      ).toEqual(['Pagó $300.00', 'Quedó a crédito $940.00']);
    });

    it('contado: pagó todo, nada a crédito', () => {
      expect(
        leer(datosDePago({ contado_credito: 'contado', monto_total_centavos: 91200, abono_centavos: null })),
      ).toEqual(['Pagó $912.00', 'Quedó a crédito $0.00']);
    });

    it('crédito sin abono: no pagó nada, todo a crédito', () => {
      expect(
        leer(datosDePago({ contado_credito: 'credito', monto_total_centavos: 62400, abono_centavos: null })),
      ).toEqual(['Pagó $0.00', 'Quedó a crédito $624.00']);
    });
  });

  it('Sincronizada: Sí solo cuando ya subió', () => {
    expect(textoSincronizada('sincronizado')).toBe('Sí');
    expect(textoSincronizada('pendiente')).toBe('No');
    expect(textoSincronizada('enviando')).toBe('No');
    expect(textoSincronizada('error')).toBe('No');
  });

  it('datos de la venta: Atendió, Vendedor y Sincronizada; sin Atendió en ventas viejas', () => {
    expect(leer(datosDeLaVenta({ atendio_nombre: 'Doña Chuy', sync_estado: 'sincronizado' }, 'Juan Pérez'))).toEqual([
      'Atendió Doña Chuy',
      'Vendedor Juan Pérez',
      'Sincronizada Sí',
    ]);
    expect(leer(datosDeLaVenta({ atendio_nombre: null, sync_estado: 'error' }, 'Juan Pérez'))).toEqual([
      'Vendedor Juan Pérez',
      'Sincronizada No',
    ]);
  });

  it('encabezado: "Nota <folio> · HH:mm"', () => {
    const grabada = new Date('2026-11-18T10:15:00').toISOString();
    expect(encabezadoVenta({ folio: 'TJ261118JP02', grabada_en: grabada })).toBe('Nota TJ261118JP02 · 10:15');
  });

  describe('renglones de la venta', () => {
    const linea = (etiqueta: string, cantidad: number, precio: number, cantidadPromocion = 0) => ({
      etiqueta,
      cantidad,
      cantidadPromocion,
      precioCentavos: precio,
      importeCentavos: cantidad * precio,
    });

    it('"24 × Jamaica 500 ml $432.00" y las promociones a $0.00 con su frase', () => {
      expect(
        renglonesDeVenta({
          lineas: [
            linea('Jamaica 500 ml', 24, 1800),
            linea('Mango 500 ml', 12, 3533, 4),
            // Una linea de pura promocion no se pinta como "0 × ...".
            linea('Tamarindo 1 L', 0, 0, 2),
          ],
          promociones: [
            { etiqueta: 'Mango 500 ml', cantidad: 4, texto: 'Por cada 12, 4 de regalo' },
            { etiqueta: 'Tamarindo 1 L', cantidad: 2, texto: 'Bienvenida' },
          ],
        }),
      ).toEqual([
        { texto: '24 × Jamaica 500 ml', importeCentavos: 43200, frase: null },
        { texto: '12 × Mango 500 ml', importeCentavos: 42396, frase: null },
        { texto: '4 × Mango 500 ml (promoción)', importeCentavos: 0, frase: 'Por cada 12, 4 de regalo' },
        { texto: '2 × Tamarindo 1 L (promoción)', importeCentavos: 0, frase: 'Bienvenida' },
      ]);
    });

    it('una venta vieja sin regalos guardados saca la promoción de sus renglones, sin frase', () => {
      expect(
        renglonesDeVenta({ lineas: [linea('Jamaica 500 ml', 24, 1800, 2)], promociones: [] }),
      ).toEqual([
        { texto: '24 × Jamaica 500 ml', importeCentavos: 43200, frase: null },
        { texto: '2 × Jamaica 500 ml (promoción)', importeCentavos: 0, frase: null },
      ]);
    });
  });

  describe('cobro', () => {
    const folios: Record<string, string> = { 'nota-1': 'TJ261030JP04', 'nota-2': 'TJ261103JP07' };
    const folioDeNota = (id: string) => folios[id] ?? null;

    it('quedó a favor: monto menos lo aplicado; nada si cuadra o no hay reparto', () => {
      const reparto = JSON.stringify([{ venta_nota_id: 'nota-1', monto_centavos: 85000, saldo_despues_centavos: 0 }]);
      expect(quedoAFavor({ monto_centavos: 100000, reparto_json: reparto })).toEqual({
        etiqueta: 'Quedó a favor',
        valor: '$150.00',
      });
      expect(quedoAFavor({ monto_centavos: 85000, reparto_json: reparto })).toBeNull();
      expect(quedoAFavor({ monto_centavos: 5000, reparto_json: '[]' })).toBeNull();
    });

    it('lista vacía: Notas pendientes habla de notas por cobrar', () => {
      expect(mensajeRegistroVacio('pendientes')).toBe('No traes notas por cobrar.');
      expect(mensajeRegistroVacio('todo')).toBe('Aún no hay movimientos hoy.');
    });

    it('una nota por cada linea del reparto: folio, aplicado y saldo despues', () => {
      expect(
        notasDelCobro(
          {
            venta_nota_id: 'nota-1',
            monto_centavos: 100000,
            reparto_json: JSON.stringify([
              { venta_nota_id: 'nota-1', monto_centavos: 85000, saldo_despues_centavos: 0 },
              { venta_nota_id: 'nota-2', monto_centavos: 15000, saldo_despues_centavos: 25000 },
            ]),
          },
          folioDeNota,
        ),
      ).toEqual([
        { folio: 'Nota TJ261030JP04', aplicado: 'Aplicado $850.00', saldoDespues: 'Saldo después $0.00' },
        { folio: 'Nota TJ261103JP07', aplicado: 'Aplicado $150.00', saldoDespues: 'Saldo después $250.00' },
      ]);
    });

    it('cobro viejo sin reparto: la nota elegida con todo el monto; sin saldo guardado no se inventa', () => {
      expect(notasDelCobro({ venta_nota_id: 'nota-x', monto_centavos: 5000, reparto_json: '[]' }, folioDeNota)).toEqual([
        { folio: 'Nota que ya no está en la tablet', aplicado: 'Aplicado $50.00', saldoDespues: null },
      ]);
      expect(
        notasDelCobro(
          {
            venta_nota_id: 'nota-1',
            monto_centavos: 5000,
            reparto_json: JSON.stringify([{ venta_nota_id: 'nota-1', monto_centavos: 5000 }]),
          },
          folioDeNota,
        ),
      ).toEqual([{ folio: 'Nota TJ261030JP04', aplicado: 'Aplicado $50.00', saldoDespues: null }]);
    });

    it('datos del cobro: Monto, Método y Sincronizada', () => {
      expect(
        leer(datosDelCobro({ monto_centavos: 40000, metodo_pago: 'transferencia', sync_estado: 'pendiente' })),
      ).toEqual(['Monto $400.00', 'Método Transferencia', 'Sincronizada No']);
    });
  });

  describe('a donde lleva tocar un renglon', () => {
    const renglon = (r: Pick<RenglonRegistro, 'tipo' | 'id'>): RenglonRegistro => ({
      clave: `${r.tipo}:${r.id}`,
      clienteId: 'cli-1',
      hora: null,
      cliente: 'Tienda Doña Chuy',
      texto: '',
      montoCentavos: 0,
      estado: null,
      ...r,
    });
    const hayVenta = (id: string) => id === 'ven-local';

    it('venta y cobro abren su detalle', () => {
      expect(destinoRenglon(renglon({ tipo: 'venta', id: 'ven-local' }), hayVenta)).toEqual({
        tipo: 'detalle',
        detalle: 'venta',
        id: 'ven-local',
      });
      expect(destinoRenglon(renglon({ tipo: 'cobro', id: 'cob-1' }), hayVenta)).toEqual({
        tipo: 'detalle',
        detalle: 'cobro',
        id: 'cob-1',
      });
    });

    it('una nota pendiente abre su venta si es de esta tablet; si no, la hoja del cliente', () => {
      expect(destinoRenglon(renglon({ tipo: 'nota', id: 'ven-local' }), hayVenta)).toEqual({
        tipo: 'detalle',
        detalle: 'venta',
        id: 'ven-local',
      });
      expect(destinoRenglon(renglon({ tipo: 'nota', id: 'nota-1' }), hayVenta)).toEqual({
        tipo: 'cliente',
        clienteId: 'cli-1',
      });
    });
  });
});
