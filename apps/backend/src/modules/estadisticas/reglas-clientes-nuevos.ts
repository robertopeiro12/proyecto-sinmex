/*
 * Reporte de Clientes nuevos (T-51): las reglas sin base de datos. El SQL ya
 * trae la fecha de alta en hora de Tijuana; aqui solo se ordena y se cuenta.
 * El portal copia estas formas en `lib/reporte-clientes-nuevos.ts`.
 */

export interface ClienteNuevo {
  id: string;
  /** `AAAA-MM-DD` de Tijuana: coalesce(alta_cliente_en, created_at). */
  fechaAlta: string;
  nombre: string;
  sucursalCodigo: string;
  tipoNegocio: string | null;
  listaPrecio: string | null;
  telefono: string;
  encargado: string | null;
  /** Usuario del portal que lo dio de alta; `null` = no se sabe. */
  usuario: string | null;
  /** Vendedor que lo prospecto en la tablet; `null` = alta directa en el portal. */
  prospecto: string | null;
  dadoDeBaja: boolean;
}

export interface ReporteClientesNuevos {
  desde: string;
  hasta: string;
  clientes: ClienteNuevo[];
  total: number;
}

export function armarReporteClientesNuevos(
  desde: string,
  hasta: string,
  filas: ClienteNuevo[],
): ReporteClientesNuevos {
  const clientes = [...filas].sort(
    (a, b) =>
      (a.fechaAlta < b.fechaAlta ? -1 : a.fechaAlta > b.fechaAlta ? 1 : 0) ||
      a.nombre.localeCompare(b.nombre, 'es'),
  );
  return { desde, hasta, clientes, total: clientes.length };
}
