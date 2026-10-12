import type { OrigenRuta } from './rutas-diarias.repository';

/** Una fila viva de la ruta diaria de un vendedor y un dia, como la lee el reemplazo. */
export interface FilaViva {
  id: string;
  clienteId: string;
  orden: number;
  origen: OrigenRuta;
}

/** Lo que el `PUT` tiene que escribir. */
export interface PlanReemplazo {
  actualizar: { id: string; orden: number; origen: OrigenRuta }[];
  insertar: { clienteId: string; orden: number }[];
  /** Ids que se dan de baja (`deleted_at`). Solo filas de la oficina. */
  borrar: string[];
}

/**
 * El reemplazo de la ruta del portal (D14), sin base: la regla entera en una
 * funcion que se puede probar sola.
 *
 * - Cada cliente de la lista, en la posicion `i`, queda con `orden = i + 1` y
 *   `origen = 'oficina'`: si ya habia una fila viva (de cualquier origen) se
 *   actualiza esa; si no, se inserta. Asi la oficina **adopta** lo que el
 *   vendedor ya habia subido, sin crear otra fila.
 * - Las filas de la oficina que no vienen, se borran.
 * - Las del vendedor que no vienen **se conservan** y se renumeran al final en
 *   su orden relativo: el portal no puede quitar lo que agrego el vendedor (D2).
 *
 * Una fila que ya tiene el orden y el origen que le tocan no se toca: moveria
 * su `updated_at` y bajaria otra vez en el pull de la tablet sin haber cambiado.
 */
export function planearReemplazo(
  vivas: readonly FilaViva[],
  clientes: readonly string[],
): PlanReemplazo {
  const porCliente = new Map(vivas.map((f) => [f.clienteId, f]));
  const pedidos = new Set(clientes);
  const plan: PlanReemplazo = { actualizar: [], insertar: [], borrar: [] };

  const fijar = (fila: FilaViva, orden: number, origen: OrigenRuta) => {
    if (fila.orden !== orden || fila.origen !== origen) {
      plan.actualizar.push({ id: fila.id, orden, origen });
    }
  };

  clientes.forEach((clienteId, i) => {
    const fila = porCliente.get(clienteId);
    if (fila) fijar(fila, i + 1, 'oficina');
    else plan.insertar.push({ clienteId, orden: i + 1 });
  });

  const fuera = vivas
    .filter((f) => !pedidos.has(f.clienteId))
    .sort((a, b) => a.orden - b.orden);
  let siguiente = clientes.length;
  for (const f of fuera) {
    if (f.origen === 'oficina') plan.borrar.push(f.id);
    else fijar(f, ++siguiente, 'vendedor');
  }

  return plan;
}
