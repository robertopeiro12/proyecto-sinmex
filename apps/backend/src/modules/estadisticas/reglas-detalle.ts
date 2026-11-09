/*
 * Flujo diario, detalle de un vendedor-dia y de un dia de sucursal: las reglas
 * sin base de datos. El repositorio entrega filas planas; aqui se agrupa,
 * se ordena y se calcula el corte con `resumir` (la misma cuenta del renglon).
 */
import { resumir } from './reglas-flujo-diario';

export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

export interface PagoDetalle {
  folio: string;
  cliente: string;
  montoCentavos: number;
  metodo: MetodoPago;
  /** `cobranza_abono.saldo_pendiente`: lo que queda de la nota despues de ese pago. */
  saldoPendienteCentavos: number;
  liquidada: boolean;
}

export interface NotaDetalle {
  folio: string;
  cliente: string;
  contadoCredito: 'contado' | 'credito';
  piezas: number;
  totalCentavos: number;
  pendienteCentavos: number;
  lineas: { producto: string; cantidad: number; precioCentavos: number }[];
}

export interface Corte {
  contadoCentavos: number;
  anterioresCentavos: number;
  aFavorCentavos: number;
  gastoCentavos: number;
  tesoreriaCentavos: number;
}

export interface VisitaDetalle {
  cliente: string;
  vendio: boolean;
  /** ISO (UTC); el portal la pinta en hora de Tijuana. */
  hora: string | null;
  motivo: string | null;
  atendio: string | null;
  comentario: string | null;
}

export interface DetalleVendedorDia {
  fecha: string;
  vendedorId: string;
  vendedor: string;
  porProducto: { presentacion: string; producto: string; piezas: number }[];
  notas: NotaDetalle[];
  cobranza: {
    contado: PagoDetalle[];
    anteriores: PagoDetalle[];
    aFavor: { cliente: string; montoCentavos: number }[];
  };
  gastos: { descripcion: string; montoCentavos: number }[];
  notasCredito: {
    folio: string;
    cliente: string;
    totalCentavos: number;
    pendienteCentavos: number;
  }[];
  visitas: VisitaDetalle[];
  promociones: { cliente: string; producto: string; cantidad: number }[];
  /** `null` sin jornada cerrada. */
  corte: Corte | null;
}

export interface DetalleDia {
  fecha: string;
  sucursalCodigo: string;
  porPresentacion: { presentacion: string; piezas: number }[];
  porProducto: { producto: string; piezas: number }[];
  porVendedor: { vendedor: string; presentacion: string; piezas: number }[];
  porCliente: { cliente: string; presentacion: string; piezas: number }[];
  /** `cobrador` null = Oficina. */
  cobranza: (PagoDetalle & { cobrador: string | null })[];
  aFavor: {
    cobrador: string | null;
    cliente: string;
    montoCentavos: number;
  }[];
  gastos: { vendedor: string; descripcion: string; montoCentavos: number }[];
  visitas: (Omit<VisitaDetalle, 'atendio'> & { vendedor: string })[];
  promociones: { producto: string; cantidad: number }[];
}

/* ---- Filas planas que entrega el repositorio ---- */

export interface VentaFila {
  ventaId: string;
  folio: string;
  cliente: string;
  vendedorId: string;
  vendedor: string;
  clienteId: string;
  contadoCredito: 'contado' | 'credito';
  totalCentavos: number;
  pendienteCentavos: number;
  /** ISO. */
  hora: string;
}

export interface LineaFila {
  ventaId: string;
  /** Volumen: "500 ml". */
  presentacion: string;
  /** "Agua 500 ml". */
  producto: string;
  cantidad: number;
  precioCentavos: number;
}

export interface PagoFila {
  tipo: 'contado' | 'anterior';
  folio: string;
  cliente: string;
  montoCentavos: number;
  metodo: MetodoPago;
  saldoPendienteCentavos: number;
  /** null = Oficina. */
  cobrador: string | null;
}

export interface AFavorFila {
  cobrador: string | null;
  cliente: string;
  montoCentavos: number;
}

export interface GastoFila {
  vendedor: string;
  descripcion: string;
  montoCentavos: number;
}

export interface VisitaSinVentaFila {
  vendedor: string;
  cliente: string;
  hora: string;
  motivo: string;
  atendio: string | null;
  comentario: string | null;
}

export interface PromoFila {
  cliente: string;
  producto: string;
  cantidad: number;
}

/**
 * Mililitros de una etiqueta de volumen: "500 ml" = 500, "1 Lt" / "1 L" = 1000,
 * "1.5 Lt" = 1500. `null` si no se entiende.
 */
export function mililitros(etiqueta: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(ml|l|lt|lts|litro|litros)\s*$/i.exec(
    etiqueta,
  );
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return m[2].toLowerCase() === 'ml' ? n : n * 1000;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Los null (Oficina) al final. */
/** Por volumen numerico; lo que no se entiende, al final y por texto. */
export function cmpVolumen(a: string, b: string): number {
  const x = mililitros(a);
  const y = mililitros(b);
  if (x !== null && y !== null) return x - y || cmp(a, b);
  if (x !== null) return -1;
  if (y !== null) return 1;
  return cmp(a, b);
}

const cmpNulo = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : cmp(a, b);

export function aPago(p: PagoFila): PagoDetalle {
  return {
    folio: p.folio,
    cliente: p.cliente,
    montoCentavos: p.montoCentavos,
    metodo: p.metodo,
    saldoPendienteCentavos: p.saldoPendienteCentavos,
    liquidada: p.saldoPendienteCentavos === 0,
  };
}

/** Suma `piezas` por la llave que da `clave`; conserva los campos de la primera. */
function agrupar<T extends { piezas: number }>(
  items: T[],
  clave: (x: T) => string,
): T[] {
  const m = new Map<string, T>();
  for (const x of items) {
    const k = clave(x);
    const previo = m.get(k);
    if (previo) previo.piezas += x.piezas;
    else m.set(k, { ...x });
  }
  return [...m.values()];
}

/** Una linea con su venta. */
function lineasConVenta(ventas: VentaFila[], lineas: LineaFila[]) {
  const porId = new Map(ventas.map((v) => [v.ventaId, v]));
  const salida: { venta: VentaFila; linea: LineaFila }[] = [];
  for (const linea of lineas) {
    const venta = porId.get(linea.ventaId);
    if (venta) salida.push({ venta, linea });
  }
  return salida;
}

const mezclarVisitas = <V extends { vendio: boolean; hora: string | null }>(
  vs: V[],
): V[] =>
  [...vs].sort((a, b) =>
    a.hora === b.hora
      ? 0
      : a.hora === null
        ? 1
        : b.hora === null
          ? -1
          : cmp(a.hora, b.hora),
  );

export function armarDetalleVendedor(
  base: {
    fecha: string;
    vendedorId: string;
    vendedor: string;
    jornadaCerrada: boolean;
  },
  filas: {
    ventas: VentaFila[];
    lineas: LineaFila[];
    pagos: PagoFila[];
    aFavor: AFavorFila[];
    gastos: GastoFila[];
    visitasSinVenta: VisitaSinVentaFila[];
    promociones: PromoFila[];
  },
): DetalleVendedorDia {
  const ventas = [...filas.ventas].sort(
    (a, b) => cmp(a.hora, b.hora) || cmp(a.folio, b.folio),
  );

  const porProducto = agrupar(
    filas.lineas.map((l) => ({
      presentacion: l.presentacion,
      producto: l.producto,
      piezas: l.cantidad,
    })),
    (x) => `${x.presentacion}|${x.producto}`,
  ).sort(
    (a, b) =>
      cmpVolumen(a.presentacion, b.presentacion) ||
      b.piezas - a.piezas ||
      cmp(a.producto, b.producto),
  );

  const notas: NotaDetalle[] = ventas.map((v) => {
    const suyas = filas.lineas.filter((l) => l.ventaId === v.ventaId);
    return {
      folio: v.folio,
      cliente: v.cliente,
      contadoCredito: v.contadoCredito,
      piezas: suyas.reduce((s, l) => s + l.cantidad, 0),
      totalCentavos: v.totalCentavos,
      pendienteCentavos: v.pendienteCentavos,
      lineas: suyas.map((l) => ({
        producto: l.producto,
        cantidad: l.cantidad,
        precioCentavos: l.precioCentavos,
      })),
    };
  });

  const contado = filas.pagos.filter((p) => p.tipo === 'contado').map(aPago);
  const anteriores = filas.pagos
    .filter((p) => p.tipo === 'anterior')
    .map(aPago);
  const aFavor = filas.aFavor.map((a) => ({
    cliente: a.cliente,
    montoCentavos: a.montoCentavos,
  }));
  const suma = (xs: { montoCentavos: number }[]) =>
    xs.reduce((s, x) => s + x.montoCentavos, 0);

  const visitas: VisitaDetalle[] = mezclarVisitas([
    ...ventas.map((v) => ({
      cliente: v.cliente,
      vendio: true,
      hora: v.hora,
      motivo: null,
      atendio: null,
      comentario: null,
    })),
    ...filas.visitasSinVenta.map((v) => ({
      cliente: v.cliente,
      vendio: false,
      hora: v.hora,
      motivo: v.motivo,
      atendio: v.atendio,
      comentario: v.comentario,
    })),
  ]);

  let corte: Corte | null = null;
  if (base.jornadaCerrada) {
    // La misma cuenta del renglon de Tarea 2: nunca se repite la aritmetica.
    const r = resumir({
      fecha: base.fecha,
      vendedorId: base.vendedorId,
      vendedor: base.vendedor,
      sucursalCodigo: '',
      clientesEnRuta: 0,
      atendidosEnRuta: 0,
      piezas: 0,
      montoCentavos: 0,
      contadoCentavos: suma(contado),
      anterioresCentavos: suma(anteriores),
      aFavorCentavos: suma(aFavor),
      gastoCentavos: suma(filas.gastos),
      jornadaCerrada: true,
      vehiculo: null,
    });
    corte = {
      contadoCentavos: r.contadoCentavos,
      anterioresCentavos: r.anterioresCentavos,
      aFavorCentavos: r.aFavorCentavos,
      gastoCentavos: r.gastoCentavos,
      tesoreriaCentavos: r.tesoreriaCentavos,
    };
  }

  return {
    fecha: base.fecha,
    vendedorId: base.vendedorId,
    vendedor: base.vendedor,
    porProducto,
    notas,
    cobranza: { contado, anteriores, aFavor },
    gastos: filas.gastos.map((g) => ({
      descripcion: g.descripcion,
      montoCentavos: g.montoCentavos,
    })),
    notasCredito: ventas
      .filter((v) => v.contadoCredito === 'credito')
      .map((v) => ({
        folio: v.folio,
        cliente: v.cliente,
        totalCentavos: v.totalCentavos,
        pendienteCentavos: v.pendienteCentavos,
      })),
    visitas,
    promociones: [...filas.promociones].sort(
      (a, b) => cmp(a.cliente, b.cliente) || cmp(a.producto, b.producto),
    ),
    corte,
  };
}

export function armarDetalleDia(
  base: { fecha: string; sucursalCodigo: string },
  filas: {
    ventas: VentaFila[];
    lineas: LineaFila[];
    pagos: PagoFila[];
    aFavor: AFavorFila[];
    gastos: GastoFila[];
    visitasSinVenta: VisitaSinVentaFila[];
    promociones: PromoFila[];
  },
): DetalleDia {
  const conVenta = lineasConVenta(filas.ventas, filas.lineas);

  const porPresentacion = agrupar(
    conVenta.map(({ linea }) => ({
      presentacion: linea.presentacion,
      piezas: linea.cantidad,
    })),
    (x) => x.presentacion,
  ).sort((a, b) => cmpVolumen(a.presentacion, b.presentacion));

  const porProducto = agrupar(
    conVenta.map(({ linea }) => ({
      producto: linea.producto,
      piezas: linea.cantidad,
    })),
    (x) => x.producto,
  ).sort((a, b) => b.piezas - a.piezas || cmp(a.producto, b.producto));

  const porVendedor = agrupar(
    conVenta.map(({ venta, linea }) => ({
      vendedorId: venta.vendedorId,
      vendedor: venta.vendedor,
      presentacion: linea.presentacion,
      piezas: linea.cantidad,
    })),
    (x) => `${x.vendedorId}|${x.presentacion}`,
  ).sort(
    (a, b) =>
      cmp(a.vendedor, b.vendedor) ||
      cmp(a.vendedorId, b.vendedorId) ||
      cmpVolumen(a.presentacion, b.presentacion),
  );

  const porCliente = agrupar(
    conVenta.map(({ venta, linea }) => ({
      clienteId: venta.clienteId,
      cliente: venta.cliente,
      presentacion: linea.presentacion,
      piezas: linea.cantidad,
    })),
    (x) => `${x.clienteId}|${x.presentacion}`,
  ).sort(
    (a, b) =>
      cmp(a.cliente, b.cliente) ||
      cmp(a.clienteId, b.clienteId) ||
      cmpVolumen(a.presentacion, b.presentacion),
  );

  const promos = new Map<string, number>();
  for (const p of filas.promociones)
    promos.set(p.producto, (promos.get(p.producto) ?? 0) + p.cantidad);

  const visitas = mezclarVisitas([
    ...filas.ventas.map((v) => ({
      vendedor: v.vendedor,
      cliente: v.cliente,
      vendio: true,
      hora: v.hora,
      motivo: null as string | null,
      comentario: null as string | null,
    })),
    ...filas.visitasSinVenta.map((v) => ({
      vendedor: v.vendedor,
      cliente: v.cliente,
      vendio: false,
      hora: v.hora,
      motivo: v.motivo,
      comentario: v.comentario,
    })),
  ]);

  return {
    fecha: base.fecha,
    sucursalCodigo: base.sucursalCodigo,
    porPresentacion,
    porProducto,
    porVendedor: porVendedor.map(({ vendedor, presentacion, piezas }) => ({
      vendedor,
      presentacion,
      piezas,
    })),
    porCliente: porCliente.map(({ cliente, presentacion, piezas }) => ({
      cliente,
      presentacion,
      piezas,
    })),
    cobranza: [...filas.pagos]
      .sort(
        (a, b) =>
          cmpNulo(a.cobrador, b.cobrador) ||
          cmp(a.folio, b.folio) ||
          a.montoCentavos - b.montoCentavos,
      )
      .map((p) => ({ ...aPago(p), cobrador: p.cobrador })),
    aFavor: [...filas.aFavor].sort(
      (a, b) => cmpNulo(a.cobrador, b.cobrador) || cmp(a.cliente, b.cliente),
    ),
    gastos: [...filas.gastos].sort(
      (a, b) =>
        cmp(a.vendedor, b.vendedor) || cmp(a.descripcion, b.descripcion),
    ),
    visitas,
    promociones: [...promos.entries()]
      .map(([producto, cantidad]) => ({ producto, cantidad }))
      .sort((a, b) => cmp(a.producto, b.producto)),
  };
}
