import { armarReporteVentas, type FilaVenta } from './reglas-reporte-ventas';

const fila = (extra: Partial<FilaVenta>): FilaVenta => ({
  id: 'v',
  fecha: '2026-10-13',
  folio: 'TJ261013AP01',
  cliente: 'Cobach XXI',
  numNota: null,
  vendedorId: 'juan',
  repartidor: 'Juan Pérez',
  status: 'pagada',
  factura: 'N/A',
  semana: 42,
  cantidad: 20,
  promocion: 2,
  montoCentavos: 13000,
  ...extra,
});

describe('armarReporteVentas', () => {
  it('sin ventas: sin dias, sin repartidores y total en cero', () => {
    expect(armarReporteVentas('2026-10-01', '2026-10-14', [])).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-14',
      dias: [],
      porRepartidor: [],
      total: { ventas: 0, cantidad: 0, promocion: 0, montoCentavos: 0 },
    });
  });

  it('agrupa por dia (asc) con ventas por folio (asc) y subtotales', () => {
    const r = armarReporteVentas('2026-10-01', '2026-10-14', [
      fila({
        id: 'b',
        fecha: '2026-10-14',
        folio: 'TJ261014AP02',
        cantidad: 30,
        promocion: 0,
        montoCentavos: 19500,
      }),
      fila({
        id: 'a2',
        folio: 'TJ261013OF01',
        vendedorId: null,
        repartidor: null,
        cantidad: 12,
        promocion: 0,
        montoCentavos: 7800,
      }),
      fila({ id: 'a1' }),
    ]);
    expect(r.dias.map((d) => d.fecha)).toEqual(['2026-10-13', '2026-10-14']);
    expect(r.dias[0].ventas.map((v) => v.id)).toEqual(['a1', 'a2']);
    expect(r.dias[0].subtotal).toEqual({
      ventas: 2,
      cantidad: 32,
      promocion: 2,
      montoCentavos: 20800,
    });
    expect(r.dias[1].subtotal).toEqual({
      ventas: 1,
      cantidad: 30,
      promocion: 0,
      montoCentavos: 19500,
    });
    expect(r.total).toEqual({
      ventas: 3,
      cantidad: 62,
      promocion: 2,
      montoCentavos: 40300,
    });
    // La venta del reporte no expone vendedorId.
    expect(Object.keys(r.dias[0].ventas[0])).not.toContain('vendedorId');
  });

  it('resumen por repartidor: monto desc, Oficina al final en empate, suma = total', () => {
    const r = armarReporteVentas('2026-10-01', '2026-10-14', [
      fila({
        id: '1',
        vendedorId: 'juan',
        repartidor: 'Juan Pérez',
        montoCentavos: 5000,
        cantidad: 5,
        promocion: 0,
      }),
      fila({
        id: '2',
        vendedorId: 'juan',
        repartidor: 'Juan Pérez',
        montoCentavos: 5000,
        cantidad: 5,
        promocion: 1,
      }),
      fila({
        id: '3',
        vendedorId: null,
        repartidor: null,
        montoCentavos: 10000,
        cantidad: 10,
        promocion: 0,
      }),
      fila({
        id: '4',
        vendedorId: 'ana',
        repartidor: 'Ana López',
        montoCentavos: 10000,
        cantidad: 8,
        promocion: 0,
      }),
      fila({
        id: '5',
        vendedorId: 'pedro',
        repartidor: 'Pedro Ruiz',
        montoCentavos: 30000,
        cantidad: 25,
        promocion: 3,
      }),
    ]);
    expect(r.porRepartidor.map((p) => p.repartidor)).toEqual([
      'Pedro Ruiz',
      'Ana López',
      'Juan Pérez',
      null,
    ]);
    expect(r.porRepartidor.find((p) => p.vendedorId === 'juan')).toEqual({
      vendedorId: 'juan',
      repartidor: 'Juan Pérez',
      ventas: 2,
      cantidad: 10,
      promocion: 1,
      montoCentavos: 10000,
    });
    const suma = r.porRepartidor.reduce(
      (s, p) => ({
        ventas: s.ventas + p.ventas,
        cantidad: s.cantidad + p.cantidad,
        promocion: s.promocion + p.promocion,
        montoCentavos: s.montoCentavos + p.montoCentavos,
      }),
      { ventas: 0, cantidad: 0, promocion: 0, montoCentavos: 0 },
    );
    expect(suma).toEqual(r.total);
  });

  it('una venta sin piezas (todas sus lineas borradas) cuenta en ventas y monto', () => {
    const r = armarReporteVentas('2026-10-01', '2026-10-14', [
      fila({ cantidad: 0, promocion: 0, montoCentavos: 5000 }),
    ]);
    expect(r.total).toEqual({
      ventas: 1,
      cantidad: 0,
      promocion: 0,
      montoCentavos: 5000,
    });
  });
});
