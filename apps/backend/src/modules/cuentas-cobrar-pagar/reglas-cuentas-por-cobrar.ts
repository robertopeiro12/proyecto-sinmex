import { saldoDerivadoCentavos } from '../ventas-cobranza/reglas-cobranza';

/*
 * Cuentas por Cobrar (T-22). Reglas puras: el repositorio trae las notas
 * planas, con `vence` y `diasAtraso` ya calculados en Postgres contra la fecha
 * de Tijuana; aqui se agrupan por cliente, se filtran, se suman y se ordenan.
 * El portal tiene una copia de estas formas en `lib/cuentas-por-cobrar.ts`.
 */

/** Una nota `pendiente`/`abonado` viva, tal como sale de la base. */
export interface FilaNotaPorCobrar {
  id: string;
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  /** El cliente esta dado de baja (`deleted_at`) pero aun debe: no se le puede cobrar. */
  clienteDadoDeBaja: boolean;
  fecha: string;
  folio: string;
  numNota: string | null;
  montoCentavos: number;
  abonadoCentavos: number;
  status: 'pendiente' | 'abonado';
  /** `null` = el cliente no tiene plazo de credito. */
  vence: string | null;
  /** 0 = al corriente o sin plazo. */
  diasAtraso: number;
}

export interface NotaPorCobrar {
  id: string;
  fecha: string;
  folio: string;
  numNota: string | null;
  montoCentavos: number;
  abonadoCentavos: number;
  saldoCentavos: number;
  status: 'pendiente' | 'abonado';
  vence: string | null;
  diasAtraso: number;
}

export interface ClienteConDeuda {
  clienteId: string;
  cliente: string;
  sucursalCodigo: string;
  clienteDadoDeBaja: boolean;
  saldoCentavos: number;
  vencidoCentavos: number;
  notas: NotaPorCobrar[];
}

export interface CuentasPorCobrar {
  /** `AAAA-MM-DD` de Tijuana: contra este dia se calcularon los atrasos. */
  hoy: string;
  totalCentavos: number;
  vencidoCentavos: number;
  notas: number;
  clientes: ClienteConDeuda[];
}

export function armarCuentasPorCobrar(
  hoy: string,
  filas: FilaNotaPorCobrar[],
  opciones: { soloVencidas: boolean },
): CuentasPorCobrar {
  const porCliente = new Map<string, ClienteConDeuda>();
  let totalCentavos = 0;
  let vencidoCentavos = 0;
  let notas = 0;

  for (const f of filas) {
    const saldoCentavos = saldoDerivadoCentavos(
      f.montoCentavos,
      f.abonadoCentavos,
    );
    // Datos viejos con abonos de mas: no hay nada que cobrar.
    if (saldoCentavos <= 0) continue;
    const vencida = f.diasAtraso > 0;
    if (opciones.soloVencidas && !vencida) continue;

    let cliente = porCliente.get(f.clienteId);
    if (!cliente) {
      cliente = {
        clienteId: f.clienteId,
        cliente: f.cliente,
        sucursalCodigo: f.sucursalCodigo,
        clienteDadoDeBaja: f.clienteDadoDeBaja,
        saldoCentavos: 0,
        vencidoCentavos: 0,
        notas: [],
      };
      porCliente.set(f.clienteId, cliente);
    }
    cliente.notas.push({
      id: f.id,
      fecha: f.fecha,
      folio: f.folio,
      numNota: f.numNota,
      montoCentavos: f.montoCentavos,
      abonadoCentavos: f.abonadoCentavos,
      saldoCentavos,
      status: f.status,
      vence: f.vence,
      diasAtraso: f.diasAtraso,
    });
    cliente.saldoCentavos += saldoCentavos;
    totalCentavos += saldoCentavos;
    notas += 1;
    if (vencida) {
      cliente.vencidoCentavos += saldoCentavos;
      vencidoCentavos += saldoCentavos;
    }
  }

  const clientes = [...porCliente.values()];
  for (const c of clientes) c.notas.sort(porFechaYFolio);
  clientes.sort(
    (a, b) =>
      b.vencidoCentavos - a.vencidoCentavos ||
      b.saldoCentavos - a.saldoCentavos ||
      a.cliente.localeCompare(b.cliente, 'es'),
  );
  return { hoy, totalCentavos, vencidoCentavos, notas, clientes };
}

function porFechaYFolio(a: NotaPorCobrar, b: NotaPorCobrar): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.folio !== b.folio) return a.folio < b.folio ? -1 : 1;
  return 0;
}
