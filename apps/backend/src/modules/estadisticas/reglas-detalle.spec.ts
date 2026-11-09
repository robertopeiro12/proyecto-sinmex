import {
  armarDetalleDia,
  cmpVolumen,
  armarDetalleVendedor,
  type PagoFila,
  type VentaFila,
} from './reglas-detalle';
import { resumir } from './reglas-flujo-diario';

const vacio = {
  ventas: [],
  lineas: [],
  pagos: [],
  aFavor: [],
  gastos: [],
  visitasSinVenta: [],
  promociones: [],
};
const base = {
  fecha: '2026-11-07',
  vendedorId: 'v1',
  vendedor: 'Ana',
  jornadaCerrada: true,
};
const pago = (extra: Partial<PagoFila>): PagoFila => ({
  tipo: 'anterior',
  folio: 'TJ1',
  cliente: 'C',
  montoCentavos: 1000,
  metodo: 'efectivo',
  saldoPendienteCentavos: 0,
  cobrador: 'Ana',
  ...extra,
});
const venta = (extra: Partial<VentaFila>): VentaFila => ({
  ventaId: 'x1',
  folio: 'TJ1',
  cliente: 'C',
  vendedorId: 'v1',
  vendedor: 'Ana',
  clienteId: 'c1',
  contadoCredito: 'contado',
  totalCentavos: 1000,
  pendienteCentavos: 0,
  hora: '2026-11-07T18:00:00.000Z',
  ...extra,
});

describe('armarDetalleVendedor', () => {
  it('liquidada solo cuando el saldo pendiente es 0', () => {
    const d = armarDetalleVendedor(base, {
      ...vacio,
      pagos: [
        pago({ saldoPendienteCentavos: 15000 }),
        pago({ folio: 'TJ2', saldoPendienteCentavos: 0 }),
      ],
    });
    expect(d.cobranza.anteriores.map((p) => p.liquidada)).toEqual([
      false,
      true,
    ]);
  });

  it('un cobro de 100 000 en dos notas y 10 000 a favor suma 100 000', () => {
    const d = armarDetalleVendedor(base, {
      ...vacio,
      pagos: [
        pago({ montoCentavos: 60000 }),
        pago({ folio: 'TJ2', montoCentavos: 30000 }),
      ],
      aFavor: [{ cobrador: 'Ana', cliente: 'C', montoCentavos: 10000 }],
    });
    expect(d.cobranza.anteriores).toHaveLength(2);
    expect(d.cobranza.aFavor).toEqual([{ cliente: 'C', montoCentavos: 10000 }]);
    expect(d.corte).toMatchObject({
      anterioresCentavos: 90000,
      aFavorCentavos: 10000,
    });
  });

  it('el corte coincide con resumir y es null sin jornada', () => {
    const filas = {
      ...vacio,
      pagos: [
        pago({ tipo: 'contado', montoCentavos: 5000 }),
        pago({ montoCentavos: 7000 }),
      ],
      aFavor: [{ cobrador: 'Ana', cliente: 'C', montoCentavos: 300 }],
      gastos: [{ vendedor: 'Ana', descripcion: 'Hielo', montoCentavos: 1000 }],
    };
    const r = resumir({
      fecha: base.fecha,
      vendedorId: 'v1',
      vendedor: 'Ana',
      sucursalCodigo: 'TJ',
      clientesEnRuta: 0,
      atendidosEnRuta: 0,
      piezas: 0,
      montoCentavos: 0,
      contadoCentavos: 5000,
      anterioresCentavos: 7000,
      aFavorCentavos: 300,
      gastoCentavos: 1000,
      jornadaCerrada: true,
      vehiculo: null,
    });
    expect(armarDetalleVendedor(base, filas).corte).toEqual({
      contadoCentavos: 5000,
      anterioresCentavos: 7000,
      aFavorCentavos: 300,
      gastoCentavos: 1000,
      tesoreriaCentavos: r.tesoreriaCentavos,
    });
    expect(
      armarDetalleVendedor({ ...base, jornadaCerrada: false }, filas).corte,
    ).toBeNull();
  });

  it('visitas mezcladas salen por hora: la de 9:15 antes que la venta de 10:53', () => {
    const d = armarDetalleVendedor(base, {
      ...vacio,
      ventas: [venta({ hora: '2026-11-07T17:53:00.000Z' })],
      visitasSinVenta: [
        {
          vendedor: 'Ana',
          cliente: 'D',
          hora: '2026-11-07T16:15:00.000Z',
          motivo: 'Cerrado',
          atendio: null,
          comentario: null,
        },
      ],
    });
    expect(d.visitas.map((v) => [v.cliente, v.vendio])).toEqual([
      ['D', false],
      ['C', true],
    ]);
  });

  it('notasCredito solo a credito y notas con piezas y lineas', () => {
    const d = armarDetalleVendedor(base, {
      ...vacio,
      ventas: [
        venta({}),
        venta({
          ventaId: 'x2',
          folio: 'TJ2',
          contadoCredito: 'credito',
          pendienteCentavos: 400,
        }),
      ],
      lineas: [
        {
          ventaId: 'x2',
          presentacion: '1 L',
          producto: 'Agua 1 L',
          cantidad: 3,
          precioCentavos: 650,
        },
      ],
    });
    expect(d.notasCredito.map((n) => n.folio)).toEqual(['TJ2']);
    expect(d.notas[1]).toMatchObject({ piezas: 3 });
    expect(d.porProducto).toEqual([
      { presentacion: '1 L', producto: 'Agua 1 L', piezas: 3 },
    ]);
  });
});

describe('armarDetalleDia', () => {
  it('porPresentacion suma por volumen aunque sean dos productos', () => {
    const d = armarDetalleDia(
      { fecha: '2026-11-07', sucursalCodigo: 'TJ' },
      {
        ...vacio,
        ventas: [venta({})],
        lineas: [
          {
            ventaId: 'x1',
            presentacion: '500 ml',
            producto: 'Agua 500 ml',
            cantidad: 1000,
            precioCentavos: 1,
          },
          {
            ventaId: 'x1',
            presentacion: '500 ml',
            producto: 'Jamaica 500 ml',
            cantidad: 657,
            precioCentavos: 1,
          },
        ],
      },
    );
    expect(d.porPresentacion).toEqual([
      { presentacion: '500 ml', piezas: 1657 },
    ]);
    expect(d.porProducto.map((p) => p.producto)).toEqual([
      'Agua 500 ml',
      'Jamaica 500 ml',
    ]);
  });

  it('un pago de oficina trae cobrador null y va al final', () => {
    const d = armarDetalleDia(
      { fecha: '2026-11-07', sucursalCodigo: 'TJ' },
      {
        ...vacio,
        pagos: [pago({ cobrador: null }), pago({ cobrador: 'Ana' })],
      },
    );
    expect(d.cobranza.map((p) => p.cobrador)).toEqual(['Ana', null]);
  });
});

describe('volumen', () => {
  it('ordena por mililitros, no por texto', () => {
    const l = ['1.5 Lt', '355 ml', '1 Lt', '600 ml', '500 ml', 'Galon'];
    expect([...l].sort(cmpVolumen)).toEqual([
      '355 ml',
      '500 ml',
      '600 ml',
      '1 Lt',
      '1.5 Lt',
      'Galon',
    ]);
  });
});

describe('armarDetalleDia agrupa por id', () => {
  it('dos clientes con el mismo nombre no se mezclan', () => {
    const d = armarDetalleDia(
      { fecha: '2026-11-07', sucursalCodigo: 'TJ' },
      {
        ...vacio,
        ventas: [
          venta({ ventaId: 'a', clienteId: 'c1', vendedorId: 'v1' }),
          venta({ ventaId: 'b', clienteId: 'c2', vendedorId: 'v2' }),
        ],
        lineas: ['a', 'b'].map((ventaId) => ({
          ventaId,
          presentacion: '1 L',
          producto: 'Agua 1 L',
          cantidad: 2,
          precioCentavos: 1,
        })),
      },
    );
    expect(d.porCliente).toHaveLength(2);
    expect(d.porVendedor).toHaveLength(2);
  });
});
