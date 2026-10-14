/*
 * Reporte de Ventas (T-49): las reglas sin base de datos. El repositorio trae
 * ventas planas (piezas ya sumadas de lineas vivas, monto en centavos); aqui se
 * agrupan por dia, se arma el resumen por repartidor y se suma. La fuente de
 * julio lo pide asi: "resultados por vendedor y por dia". El portal tiene una
 * copia de estas formas en `lib/reporte-ventas.ts`.
 */

export type StatusVenta =
  'pagada' | 'pendiente' | 'abonado' | 'cuenta_perdida' | 'promocion';

/** Lo que trae el SQL por venta. */
export interface FilaVenta {
  id: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  folio: string;
  cliente: string;
  numNota: string | null;
  /** `null` = venta de mostrador (Oficina). Solo para agrupar. */
  vendedorId: string | null;
  repartidor: string | null;
  status: StatusVenta;
  /** 'N/A', 'Pendiente' o el numero de factura. */
  factura: string;
  semana: number;
  cantidad: number;
  promocion: number;
  montoCentavos: number;
}

export type VentaEnReporte = Omit<FilaVenta, 'vendedorId'>;

export interface TotalVentas {
  ventas: number;
  cantidad: number;
  promocion: number;
  montoCentavos: number;
}

export interface DiaDeVentas {
  fecha: string;
  ventas: VentaEnReporte[];
  subtotal: TotalVentas;
}

export interface RepartidorEnReporte extends TotalVentas {
  /** `null` = Oficina. */
  vendedorId: string | null;
  repartidor: string | null;
}

export interface ReporteVentas {
  desde: string;
  hasta: string;
  dias: DiaDeVentas[];
  porRepartidor: RepartidorEnReporte[];
  total: TotalVentas;
}

const cero = (): TotalVentas => ({
  ventas: 0,
  cantidad: 0,
  promocion: 0,
  montoCentavos: 0,
});

function sumar(t: TotalVentas, f: FilaVenta): void {
  t.ventas += 1;
  t.cantidad += f.cantidad;
  t.promocion += f.promocion;
  t.montoCentavos += f.montoCentavos;
}

export function armarReporteVentas(
  desde: string,
  hasta: string,
  filas: FilaVenta[],
): ReporteVentas {
  const ordenadas = [...filas].sort((a, b) =>
    a.fecha !== b.fecha
      ? a.fecha < b.fecha
        ? -1
        : 1
      : a.folio < b.folio
        ? -1
        : a.folio > b.folio
          ? 1
          : 0,
  );

  const dias: DiaDeVentas[] = [];
  const porVendedor = new Map<string, RepartidorEnReporte>();
  const total = cero();

  for (const f of ordenadas) {
    let dia = dias[dias.length - 1];
    if (!dia || dia.fecha !== f.fecha) {
      dia = { fecha: f.fecha, ventas: [], subtotal: cero() };
      dias.push(dia);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { vendedorId, ...venta } = f;
    dia.ventas.push(venta);
    sumar(dia.subtotal, f);
    sumar(total, f);

    const llave = f.vendedorId ?? 'oficina';
    let rep = porVendedor.get(llave);
    if (!rep) {
      rep = { vendedorId: f.vendedorId, repartidor: f.repartidor, ...cero() };
      porVendedor.set(llave, rep);
    }
    sumar(rep, f);
  }

  const porRepartidor = [...porVendedor.values()].sort(
    (a, b) =>
      b.montoCentavos - a.montoCentavos ||
      Number(a.repartidor === null) - Number(b.repartidor === null) ||
      (a.repartidor ?? '').localeCompare(b.repartidor ?? '', 'es'),
  );

  return { desde, hasta, dias, porRepartidor, total };
}
