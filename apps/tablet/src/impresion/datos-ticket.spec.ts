import { ATENDIO_DE_PRUEBA, depsDePrueba, MOMENTO, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioCobranzas } from '@/datos/repositorios/cobranzas';
import { crearRepositorioFolios } from '@/datos/repositorios/folios';
import { crearRepositorioVentas, type DatosRegistroVenta } from '@/datos/repositorios/ventas';
import type { DetalleNotaPull } from '@/sincronizacion/contrato';

import { estadoTicket, type DatosTicket } from './ticket';
import {
  imprimirEnOrden,
  ticketDeNota,
  ticketDeVenta,
  ticketDeVentaParaReimprimir,
  ticketsDelCobro,
  VENDEDOR_DESCONOCIDO,
} from './datos-ticket';

/** Rediseño pieza 7: la nota impresa sale de la base local. */

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const folios = crearRepositorioFolios(deps);
  return {
    deps,
    bd: deps.bd,
    ventas: crearRepositorioVentas(deps, { catalogos, folios }),
    cobranzas: crearRepositorioCobranzas(deps, { catalogos }),
  };
}

const TEXTO = 'Por cada 10 Jamaica, 1 Jamaica gratis';

const venta = (extra: Partial<DatosRegistroVenta> = {}): DatosRegistroVenta => ({
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  contadoCredito: 'contado',
  lineas: [{ presentacionId: 'pre-1', cantidad: 12, cantidadPromocion: 1 }],
  regalos: [{ promocionId: 'promo-general', presentacionId: 'pre-1', cantidad: 1, texto: TEXTO }],
  atendio: ATENDIO_DE_PRUEBA,
  ...extra,
});

const DETALLE: DetalleNotaPull = {
  lineas: [
    { presentacion_id: 'pre-1', etiqueta: 'Jamaica 1 L', cantidad: 10, cantidad_promocion: 1, precio_centavos: 2500 },
  ],
  promociones: [{ presentacion_id: 'pre-1', etiqueta: 'Jamaica 1 L', cantidad: 1, texto: TEXTO }],
  vendedor_nombre: 'Berta Ruiz',
  atendio: 'Don Pepe',
  sucursal_nombre: 'Tijuana',
  creada_en: '2026-08-01T18:30:00.000Z',
};

describe('ticketDeVenta', () => {
  it('de contado: renglones, promoción con su frase, LIQUIDADA', () => {
    const { bd, ventas } = montar();
    const v = ventas.registrar(venta());
    const d = ticketDeVenta(bd, v.id);
    expect(d).toEqual({
      sucursal: 'Tijuana',
      folio: v.folio,
      momento: MOMENTO,
      cliente: 'Abarrotes La Esquina',
      atendio: ATENDIO_DE_PRUEBA,
      vendedor: 'Abraham Perez',
      renglones: [{ cantidad: 12, etiqueta: 'Jamaica 1 L', precioCentavos: 2800, importeCentavos: 33600 }],
      promociones: [{ cantidad: 1, etiqueta: 'Jamaica 1 L', texto: TEXTO }],
      totalCentavos: 33600,
      abonos: [],
      saldoCentavos: 0,
      reimpresion: null,
      detalleDisponible: true,
    });
    expect(estadoTicket(d!)).toBe('LIQUIDADA');
  });

  it('a crédito: sin abonos y todo el total de saldo', () => {
    const { bd, ventas } = montar();
    const v = ventas.registrar(venta({ contadoCredito: 'credito' }));
    const d = ticketDeVenta(bd, v.id)!;
    expect(d).toMatchObject({ abonos: [], saldoCentavos: 33600, totalCentavos: 33600 });
    expect(estadoTicket(d)).toBe('CRÉDITO');
  });

  it('abonada: el abono al vender es un abono del día de la venta', () => {
    const { bd, ventas } = montar();
    const v = ventas.registrar(venta({ contadoCredito: 'credito', abonoCentavos: 10000 }));
    const d = ticketDeVenta(bd, v.id)!;
    expect(d).toMatchObject({ abonos: [{ fecha: '2026-08-07', montoCentavos: 10000 }], saldoCentavos: 23600 });
    expect(estadoTicket(d)).toBe('ABONADO');
  });

  it('solo de promoción: sin renglones vendidos, total 0, LIQUIDADA', () => {
    const { bd, ventas } = montar();
    const v = ventas.registrar(
      venta({
        clienteId: 'cli-2',
        lineas: [{ presentacionId: 'pre-2', cantidad: 0, cantidadPromocion: 2 }],
        regalos: [{ promocionId: 'promo-prospecto', presentacionId: 'pre-2', cantidad: 2, texto: 'Bienvenida' }],
      }),
    );
    const d = ticketDeVenta(bd, v.id)!;
    expect(d.renglones).toEqual([]);
    expect(d.promociones).toEqual([{ cantidad: 2, etiqueta: 'Jamaica 500 ml', texto: 'Bienvenida' }]);
    expect(d.totalCentavos).toBe(0);
    expect(estadoTicket(d)).toBe('LIQUIDADA');
  });

  it('venta vieja sin promociones aplicadas: la promoción sale de cantidad_promocion, sin frase', () => {
    const { bd, ventas } = montar();
    const v = ventas.registrar(venta());
    bd.runSync('delete from venta_promocion where venta_id = $id', { $id: v.id });
    expect(ticketDeVenta(bd, v.id)!.promociones).toEqual([{ cantidad: 1, etiqueta: 'Jamaica 1 L', texto: '' }]);
  });

  it('null si la venta no está', () => {
    expect(ticketDeVenta(montar().bd, 'no-existe')).toBeNull();
  });
});

describe('ticketDeNota', () => {
  const REIMP = { momento: '2026-08-07T16:00:00.000Z', cobro: 'Abraham Perez' };

  it('con detalle del pull: renglones, encabezado y abonos de la nota', () => {
    const { bd } = montar();
    bd.runSync("update nota_pendiente set detalle_json = $d where id = 'nota-1'", { $d: JSON.stringify(DETALLE) });
    const d = ticketDeNota(bd, 'nota-1', REIMP);
    expect(d).toEqual({
      sucursal: 'Tijuana',
      folio: 'TJ260801AP01',
      momento: '2026-08-01T18:30:00.000Z',
      cliente: 'Abarrotes La Esquina',
      atendio: 'Don Pepe',
      vendedor: 'Berta Ruiz',
      renglones: [{ cantidad: 10, etiqueta: 'Jamaica 1 L', precioCentavos: 2500, importeCentavos: 25000 }],
      promociones: [{ cantidad: 1, etiqueta: 'Jamaica 1 L', texto: TEXTO }],
      totalCentavos: 25000,
      abonos: [{ fecha: '2026-08-03', montoCentavos: 10000 }],
      saldoCentavos: 15000,
      reimpresion: REIMP,
      detalleDisponible: true,
    });
  });

  it('venta de mostrador (sin vendedor en el detalle): vendedor desconocido', () => {
    const { bd } = montar();
    bd.runSync("update nota_pendiente set detalle_json = $d where id = 'nota-1'", {
      $d: JSON.stringify({ ...DETALLE, vendedor_nombre: null }),
    });
    expect(ticketDeNota(bd, 'nota-1', null)!.vendedor).toBe(VENDEDOR_DESCONOCIDO);
  });

  it('sin detalle ni venta local: detalleDisponible false, con totales y abonos de la nota', () => {
    const { bd } = montar();
    const d = ticketDeNota(bd, 'nota-1', null)!;
    expect(d).toMatchObject({
      folio: 'TJ260801AP01',
      sucursal: 'Tijuana',
      momento: '2026-08-01T00:00:00',
      atendio: null,
      vendedor: VENDEDOR_DESCONOCIDO,
      renglones: [],
      promociones: [],
      totalCentavos: 25000,
      saldoCentavos: 15000,
      abonos: [{ fecha: '2026-08-03', montoCentavos: 10000 }],
      detalleDisponible: false,
    });
  });

  it('detalle_json corrupto cuenta como sin detalle', () => {
    const { bd } = montar();
    bd.runSync("update nota_pendiente set detalle_json = '{roto' where id = 'nota-2'");
    expect(ticketDeNota(bd, 'nota-2', null)!.detalleDisponible).toBe(false);
  });

  it('sin detalle pero vendida en esta tablet: renglones de la venta local por folio; saldo y abonos de la nota', () => {
    const { bd, ventas } = montar();
    const v = ventas.registrar(venta({ contadoCredito: 'credito', abonoCentavos: 10000 }));
    // La nota que bajó en el pull para esa venta, sin detalle (servidor viejo).
    bd.runSync(
      `insert into nota_pendiente (id, cliente_id, folio, num_nota, fecha, status, monto_total_centavos,
                                   saldo_centavos, abonos_json, activo, sincronizado_en)
       values ('nota-local', 'cli-1', $folio, null, '2026-08-07', 'abonado', 33600, 13600, $abonos, 1, $ahora)`,
      {
        $folio: v.folio,
        $abonos: JSON.stringify([
          { fecha_pago: '2026-08-07', monto_centavos: 10000, metodo_pago: 'efectivo' },
          { fecha_pago: '2026-08-07', monto_centavos: 10000, metodo_pago: 'efectivo' },
        ]),
        $ahora: MOMENTO,
      },
    );
    const d = ticketDeNota(bd, 'nota-local', null)!;
    expect(d).toMatchObject({
      detalleDisponible: true,
      atendio: ATENDIO_DE_PRUEBA,
      vendedor: 'Abraham Perez',
      momento: MOMENTO,
      renglones: [{ cantidad: 12, etiqueta: 'Jamaica 1 L', precioCentavos: 2800, importeCentavos: 33600 }],
      promociones: [{ cantidad: 1, etiqueta: 'Jamaica 1 L', texto: TEXTO }],
      saldoCentavos: 13600,
    });
    // El abono al vender no se cuenta dos veces: los abonos son los de la nota.
    expect(d.abonos).toHaveLength(2);
    expect(d.abonos.reduce((s, a) => s + a.montoCentavos, 0) + d.saldoCentavos).toBe(d.totalCentavos);
    // Reimprimir desde el detalle de la venta usa la nota (con los abonos de después).
    expect(ticketDeVentaParaReimprimir(bd, v.id)!.saldoCentavos).toBe(13600);
  });

  it('null si la nota no está', () => {
    expect(ticketDeNota(montar().bd, 'no-existe', null)).toBeNull();
  });
});

describe('ticketsDelCobro', () => {
  it('un cobro que liquida la nota la reimprime (aunque quede inactiva) con el abono nuevo y Cobró', () => {
    const { bd, cobranzas } = montar();
    const cobro = cobranzas.registrar({
      vendedorId: 'ven-1',
      clienteId: 'cli-1',
      ventaNotaId: 'nota-1',
      montoCentavos: 15000,
      metodoPago: 'efectivo',
      fechaPago: '2026-08-07',
    });
    const [d, ...resto] = ticketsDelCobro(bd, cobro, '2026-08-07T16:00:00.000Z');
    expect(resto).toEqual([]);
    expect(d).toMatchObject({
      folio: 'TJ260801AP01',
      saldoCentavos: 0,
      abonos: [
        { fecha: '2026-08-03', montoCentavos: 10000 },
        { fecha: '2026-08-07', montoCentavos: 15000 },
      ],
      reimpresion: { momento: '2026-08-07T16:00:00.000Z', cobro: 'Abraham Perez' },
    });
    expect(estadoTicket(d!)).toBe('LIQUIDADA');
  });

  it('un cobro viejo sin reparto reimprime la nota que eligió el vendedor', () => {
    const { bd } = montar();
    const tickets = ticketsDelCobro(bd, { venta_nota_id: 'nota-2', vendedor_id: 'ven-1', reparto_json: '[]' }, MOMENTO);
    expect(tickets.map((t) => t?.folio)).toEqual(['TJ260802AP03']);
  });

  it('una nota que ya no está sale como null', () => {
    const { bd } = montar();
    expect(ticketsDelCobro(bd, { venta_nota_id: 'x', vendedor_id: 'ven-1', reparto_json: '[]' }, MOMENTO)).toEqual([null]);
  });
});

describe('ticketDeVentaParaReimprimir', () => {
  it('sin nota del pull: la venta local', () => {
    const { bd, ventas } = montar();
    const v = ventas.registrar(venta({ contadoCredito: 'credito' }));
    expect(ticketDeVentaParaReimprimir(bd, v.id)).toEqual(ticketDeVenta(bd, v.id));
  });
});

describe('imprimirEnOrden', () => {
  const t = (folio: string) => ({ folio }) as unknown as DatosTicket;

  it('imprime en orden y dice si salieron todos', async () => {
    const vistos: string[] = [];
    const ok = await imprimirEnOrden(async (d) => {
      vistos.push(d.folio);
      return { ok: true };
    }, [t('A'), t('B')]);
    expect(ok).toBe(true);
    expect(vistos).toEqual(['A', 'B']);
  });

  it('un null, un fallo o un error: sigue con los demás y responde false', async () => {
    const vistos: string[] = [];
    const ok = await imprimirEnOrden(async (d) => {
      vistos.push(d.folio);
      if (d.folio === 'B') throw new Error('x');
      return { ok: d.folio !== 'C' };
    }, [t('A'), null, t('B'), t('C'), t('D')]);
    expect(ok).toBe(false);
    expect(vistos).toEqual(['A', 'B', 'C', 'D']);
  });

  it('nada que imprimir es no impreso', async () => {
    expect(await imprimirEnOrden(async () => ({ ok: true }), [])).toBe(false);
  });
});
