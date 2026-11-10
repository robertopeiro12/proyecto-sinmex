/*
 * Flujo diario: las reglas sin base de datos. El repositorio trae una fila por
 * vendedor y dia (ya sumada); aqui se calcula cobranza y tesoreria, se agrupa
 * por dia y por sucursal y se suma. El portal copia estas formas en su `lib/`.
 */

export interface FilaVendedorDia {
  /** `AAAA-MM-DD`. */
  fecha: string;
  vendedorId: string;
  vendedor: string;
  /** La del vendedor. */
  sucursalCodigo: string;
  /** Ruta diaria viva de ese dia. */
  clientesEnRuta: number;
  /** De esos, con venta o visita ese dia. */
  atendidosEnRuta: number;
  /** Lineas vivas, sin promocion. */
  piezas: number;
  montoCentavos: number;
  /** Abonos de origen `venta_contado`. */
  contadoCentavos: number;
  /** Abonos de origen `cobro`. */
  anterioresCentavos: number;
  /** Sobrante de cobros que fue a saldo a favor. */
  aFavorCentavos: number;
  gastoCentavos: number;
  jornadaCerrada: boolean;
  /** Nombre del vehiculo de la jornada. */
  vehiculo: string | null;
  /** Nombre de la ruta asignada ese dia (`ruta_dia` viva); `null` = sin ruta con nombre. */
  rutaNombre: string | null;
  /** Vehiculo asignado en la ruta del dia (`ruta_dia`), no el de la jornada. */
  vehiculoAsignado: string | null;
}

export interface ResumenVendedorDia extends FilaVendedorDia {
  /** contado + anteriores + aFavor. */
  cobranzaCentavos: number;
  /** cobranza - gasto. */
  tesoreriaCentavos: number;
  estatus: 'en_ruta' | 'terminado';
}

export interface Totales {
  rutas: number;
  piezas: number;
  montoCentavos: number;
  cobranzaCentavos: number;
  gastoCentavos: number;
  tesoreriaCentavos: number;
  clientesEnRuta: number;
  atendidosEnRuta: number;
}

export interface CobranzaOficinaDia {
  fecha: string;
  sucursalCodigo: string;
  montoCentavos: number;
}

export interface ResumenDia {
  fecha: string;
  sucursalCodigo: string;
  totales: Totales;
  oficinaCentavos: number;
}

export interface BloqueSucursal {
  sucursalCodigo: string;
  porVendedor: Totales;
  porDia: Totales;
}

export interface FlujoDiario {
  desde: string;
  hasta: string;
  /** Orden: sucursal, fecha DESC, vendedor. */
  porVendedor: ResumenVendedorDia[];
  /** Orden: sucursal, fecha DESC. */
  porDia: ResumenDia[];
  /** Uno por sucursal presente, en orden de codigo. */
  bloques: BloqueSucursal[];
  totalPorVendedor: Totales;
  /** Incluye la cobranza de la oficina. */
  totalPorDia: Totales;
}

export function resumir(f: FilaVendedorDia): ResumenVendedorDia {
  const cobranzaCentavos =
    f.contadoCentavos + f.anterioresCentavos + f.aFavorCentavos;
  return {
    ...f,
    cobranzaCentavos,
    tesoreriaCentavos: cobranzaCentavos - f.gastoCentavos,
    estatus: f.jornadaCerrada ? 'terminado' : 'en_ruta',
  };
}

/** `rutas` cuenta renglones (tambien los de ceros). La oficina suma a cobranza y tesoreria, no a gasto. */
export function sumar(
  resumenes: ResumenVendedorDia[],
  oficinaCentavos = 0,
): Totales {
  const t: Totales = {
    rutas: resumenes.length,
    piezas: 0,
    montoCentavos: 0,
    cobranzaCentavos: oficinaCentavos,
    gastoCentavos: 0,
    tesoreriaCentavos: oficinaCentavos,
    clientesEnRuta: 0,
    atendidosEnRuta: 0,
  };
  for (const r of resumenes) {
    t.piezas += r.piezas;
    t.montoCentavos += r.montoCentavos;
    t.cobranzaCentavos += r.cobranzaCentavos;
    t.gastoCentavos += r.gastoCentavos;
    t.tesoreriaCentavos += r.tesoreriaCentavos;
    t.clientesEnRuta += r.clientesEnRuta;
    t.atendidosEnRuta += r.atendidosEnRuta;
  }
  return t;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function armarFlujoDiario(
  desde: string,
  hasta: string,
  filas: FilaVendedorDia[],
  oficina: CobranzaOficinaDia[],
): FlujoDiario {
  const porVendedor = filas
    .map(resumir)
    .sort(
      (a, b) =>
        cmp(a.sucursalCodigo, b.sucursalCodigo) ||
        cmp(b.fecha, a.fecha) ||
        cmp(a.vendedor, b.vendedor) ||
        cmp(a.vendedorId, b.vendedorId),
    );

  const oficinaPorLlave = new Map<string, number>();
  const gruposPorLlave = new Map<string, ResumenVendedorDia[]>();
  const llaves = new Map<string, { fecha: string; sucursalCodigo: string }>();
  const llave = (s: string, f: string) => `${s}|${f}`;
  for (const r of porVendedor) {
    const k = llave(r.sucursalCodigo, r.fecha);
    llaves.set(k, { fecha: r.fecha, sucursalCodigo: r.sucursalCodigo });
    gruposPorLlave.set(k, [...(gruposPorLlave.get(k) ?? []), r]);
  }
  for (const o of oficina) {
    const k = llave(o.sucursalCodigo, o.fecha);
    llaves.set(k, { fecha: o.fecha, sucursalCodigo: o.sucursalCodigo });
    oficinaPorLlave.set(k, (oficinaPorLlave.get(k) ?? 0) + o.montoCentavos);
  }

  const porDia: ResumenDia[] = [...llaves.entries()]
    .map(([k, { fecha, sucursalCodigo }]) => {
      const oficinaCentavos = oficinaPorLlave.get(k) ?? 0;
      return {
        fecha,
        sucursalCodigo,
        totales: sumar(gruposPorLlave.get(k) ?? [], oficinaCentavos),
        oficinaCentavos,
      };
    })
    .sort(
      (a, b) =>
        cmp(a.sucursalCodigo, b.sucursalCodigo) || cmp(b.fecha, a.fecha),
    );

  const codigos = [
    ...new Set([
      ...porVendedor.map((r) => r.sucursalCodigo),
      ...oficina.map((o) => o.sucursalCodigo),
    ]),
  ].sort(cmp);
  const bloques: BloqueSucursal[] = codigos.map((sucursalCodigo) => {
    const suyos = porVendedor.filter(
      (r) => r.sucursalCodigo === sucursalCodigo,
    );
    const oficinaSuc = oficina
      .filter((o) => o.sucursalCodigo === sucursalCodigo)
      .reduce((s, o) => s + o.montoCentavos, 0);
    return {
      sucursalCodigo,
      porVendedor: sumar(suyos),
      porDia: sumar(suyos, oficinaSuc),
    };
  });

  return {
    desde,
    hasta,
    porVendedor,
    porDia,
    bloques,
    totalPorVendedor: sumar(porVendedor),
    totalPorDia: sumar(
      porVendedor,
      oficina.reduce((s, o) => s + o.montoCentavos, 0),
    ),
  };
}

export interface Dashboard {
  /** Hoy de Tijuana. */
  fecha: string;
  /** Orden: sucursal, vendedor. */
  vendedores: ResumenVendedorDia[];
  bloques: {
    sucursalCodigo: string;
    totales: Totales;
    enRuta: number;
    terminaron: number;
  }[];
  total: Totales & { enRuta: number; terminaron: number };
}

const contarEstatus = (rs: ResumenVendedorDia[]) => ({
  enRuta: rs.filter((r) => r.estatus === 'en_ruta').length,
  terminaron: rs.filter((r) => r.estatus === 'terminado').length,
});

/**
 * El dia que el portal puede pedir en el detalle del Dashboard: hoy o ayer de
 * Tijuana. Ayer existe para el renglon que se pinto antes de la medianoche: su
 * detalle sigue siendo de ese dia.
 */
export function fechaValidaDashboard(fecha: string, hoy: string): boolean {
  if (fecha === hoy) return true;
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return fecha === d.toISOString().slice(0, 10);
}

/** Las filas ya son de un solo dia (hoy): un renglon por vendedor. */
export function armarDashboard(
  fecha: string,
  filas: FilaVendedorDia[],
): Dashboard {
  const vendedores = filas
    .map(resumir)
    .sort(
      (a, b) =>
        cmp(a.sucursalCodigo, b.sucursalCodigo) ||
        cmp(a.vendedor, b.vendedor) ||
        cmp(a.vendedorId, b.vendedorId),
    );
  const codigos = [...new Set(vendedores.map((r) => r.sucursalCodigo))].sort(
    cmp,
  );
  const bloques = codigos.map((sucursalCodigo) => {
    const suyos = vendedores.filter((r) => r.sucursalCodigo === sucursalCodigo);
    return {
      sucursalCodigo,
      totales: sumar(suyos),
      ...contarEstatus(suyos),
    };
  });
  return {
    fecha,
    vendedores,
    bloques,
    total: { ...sumar(vendedores), ...contarEstatus(vendedores) },
  };
}
