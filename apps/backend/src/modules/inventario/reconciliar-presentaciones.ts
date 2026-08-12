/**
 * El PATCH de un producto recibe la lista COMPLETA de presentaciones que el
 * usuario quiere (D6), no una secuencia de operaciones. Esta funcion compara
 * esa lista contra lo que hay guardado y devuelve el plan a ejecutar.
 *
 * Es pura a proposito: aqui esta toda la sutileza del ticket y no necesita
 * base de datos para probarse, igual que `alcance-sucursal.ts` de T-09.
 */

export interface PresentacionExistente {
  id: string;
  volumen: string;
}

export interface PresentacionPedida {
  id?: string;
  volumen: string;
}

export interface PlanPresentaciones {
  insertar: { volumen: string }[];
  actualizar: { id: string; volumen: string }[];
  /** Ids a los que se les pone `deleted_at`. Nunca se borra fisico (D1). */
  darDeBaja: string[];
}

/** El servicio la traduce a 400: es culpa del cuerpo que mandaron. */
export class ReconciliacionInvalida extends Error {}

/**
 * Misma normalizacion que el indice unico de la base
 * (`lower(volumen)`), mas el recorte de espacios que hace el DTO. Si las dos
 * normalizaciones se separan, la base rechazaria con un 23505 generico algo
 * que esta funcion dejo pasar.
 */
const normalizar = (volumen: string): string => volumen.trim().toLowerCase();

export function reconciliarPresentaciones(
  existentes: PresentacionExistente[],
  pedidas: PresentacionPedida[],
): PlanPresentaciones {
  if (pedidas.length === 0) {
    throw new ReconciliacionInvalida(
      'El producto debe tener al menos una presentación.',
    );
  }

  const vistos = new Set<string>();
  for (const pedida of pedidas) {
    const clave = normalizar(pedida.volumen);
    if (vistos.has(clave)) {
      throw new ReconciliacionInvalida(
        `La presentación "${pedida.volumen.trim()}" está repetida.`,
      );
    }
    vistos.add(clave);
  }

  const porId = new Map(existentes.map((e) => [e.id, e]));
  const plan: PlanPresentaciones = {
    insertar: [],
    actualizar: [],
    darDeBaja: [],
  };
  const conservados = new Set<string>();

  for (const pedida of pedidas) {
    const volumen = pedida.volumen.trim();

    if (pedida.id === undefined) {
      plan.insertar.push({ volumen });
      continue;
    }

    const existente = porId.get(pedida.id);
    if (!existente) {
      throw new ReconciliacionInvalida(
        'Una de las presentaciones no pertenece a este producto.',
      );
    }

    conservados.add(existente.id);
    // Un update que no cambia nada mueve `updated_at`, y el pull de T-07 es
    // incremental: la tablet se bajaria la fila sin motivo.
    if (normalizar(existente.volumen) !== normalizar(volumen)) {
      plan.actualizar.push({ id: existente.id, volumen });
    }
  }

  for (const existente of existentes) {
    if (!conservados.has(existente.id)) {
      plan.darDeBaja.push(existente.id);
    }
  }

  return plan;
}
