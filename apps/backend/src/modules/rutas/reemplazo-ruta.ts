import type { OrigenRuta } from './rutas-diarias.repository';

/** Una fila viva de la ruta diaria de un vendedor y un dia, como la lee el reemplazo. */
export interface FilaViva {
  id: string;
  clienteId: string;
  orden: number;
  origen: OrigenRuta;
  recado: string | null;
}

/** Un cliente de la lista que manda el portal, con su recado (ya recortado; vacio = null). */
export interface PedidoCliente {
  clienteId: string;
  recado: string | null;
}

/** Lo que el `PUT` tiene que escribir. */
export interface PlanReemplazo {
  actualizar: { id: string; orden: number; recado: string | null }[];
  insertar: {
    clienteId: string;
    orden: number;
    origen: 'oficina' | 'semanal';
    recado: string | null;
  }[];
  /** Filas que se dan de baja (`deleted_at`), con quien las quito. Nunca las del vendedor. */
  borrar: {
    id: string;
    clienteId: string;
    quitadoPor: 'oficina' | 'cambio_ruta';
  }[];
}

/**
 * El reemplazo de la ruta del portal, sin base: la regla entera en una funcion
 * que se puede probar sola.
 *
 * - Cada cliente de la lista, en la posicion `i`, queda con `orden = i + 1`: si
 *   ya habia una fila viva se actualiza esa (**conserva su origen**, cambia la
 *   regla D14 de T-37) y se le pone su recado; si no, se inserta, con origen
 *   `semanal` si el cliente viene de la ruta semanal del vendedor, si no
 *   `oficina`.
 * - Las del vendedor que no vienen **se conservan** al final en su orden
 *   relativo: el portal no puede quitar lo que agrego el vendedor.
 * - Las demas que no vienen se borran, con `quitadoPor`: `cambio_ruta` solo si
 *   `rutaCambio`, la fila es `semanal` y su cliente NO esta en la semanal nueva
 *   (`clientesDeLaSemanal`): la semanal vieja lo traia y la nueva no. Si la nueva
 *   tambien lo trae y no viene en la lista, la oficina lo quito a mano en esta
 *   edicion: `oficina`. Con los datos del PUT se distinguen asi, sin campo nuevo.
 *
 * Una fila que ya tiene su orden y su recado no se toca: moveria su
 * `updated_at` y bajaria otra vez en el pull de la tablet sin haber cambiado.
 */
export function planearReemplazo(
  vivas: readonly FilaViva[],
  pedidos: readonly PedidoCliente[],
  contexto: { clientesDeLaSemanal: ReadonlySet<string>; rutaCambio: boolean },
): PlanReemplazo {
  const porCliente = new Map(vivas.map((f) => [f.clienteId, f]));
  const pedidosIds = new Set(pedidos.map((p) => p.clienteId));
  const plan: PlanReemplazo = { actualizar: [], insertar: [], borrar: [] };

  const fijar = (fila: FilaViva, orden: number, recado: string | null) => {
    if (fila.orden !== orden || fila.recado !== recado) {
      plan.actualizar.push({ id: fila.id, orden, recado });
    }
  };

  pedidos.forEach(({ clienteId, recado }, i) => {
    const fila = porCliente.get(clienteId);
    if (fila) fijar(fila, i + 1, recado);
    else {
      plan.insertar.push({
        clienteId,
        orden: i + 1,
        origen: contexto.clientesDeLaSemanal.has(clienteId)
          ? 'semanal'
          : 'oficina',
        recado,
      });
    }
  });

  const fuera = vivas
    .filter((f) => !pedidosIds.has(f.clienteId))
    .sort((a, b) => a.orden - b.orden);
  let siguiente = pedidos.length;
  for (const f of fuera) {
    if (f.origen === 'vendedor') fijar(f, ++siguiente, f.recado);
    else {
      plan.borrar.push({
        id: f.id,
        clienteId: f.clienteId,
        quitadoPor:
          contexto.rutaCambio &&
          f.origen === 'semanal' &&
          !contexto.clientesDeLaSemanal.has(f.clienteId)
            ? 'cambio_ruta'
            : 'oficina',
      });
    }
  }

  return plan;
}
