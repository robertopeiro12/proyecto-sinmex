import type {
  AudienciaPromocion,
  CompraPromocion,
  RegaloPromocion,
} from '../sincronizacion/contrato';

/** La regla completa, como la manda el portal (DTO plano) o la guarda la base. */
export interface ReglaCompleta {
  audiencia: AudienciaPromocion;
  clienteId: string | null;
  compraTipo: CompraPromocion;
  compraProductoId: string | null;
  compraPresentacionId: string | null;
  compraCantidad: number;
  regaloTipo: RegaloPromocion;
  regaloProductoId: string | null;
  regaloPresentacionId: string | null;
  regaloCantidad: number;
  seRepite: boolean;
}

/** Los productos que cubre un objetivo: todos (`cualquiera`) o un conjunto de ids. */
export type Cobertura = 'todos' | ReadonlySet<string>;

/**
 * Lo que impide guardar la regla, en el espanol de la oficina, o `null`.
 * Espejo de los `check` de la migracion (ck_promocion_*), con mensaje: el 23514
 * de Postgres seria un 500 que nadie entiende. Duplicada en el portal
 * (`lib/promociones.ts`) para validar en vivo.
 */
export function problemaDeRegla(r: ReglaCompleta): string | null {
  if (r.audiencia === 'cliente' && !r.clienteId) {
    return 'Elige el cliente de la promoción.';
  }
  if (r.audiencia !== 'cliente' && r.clienteId) {
    return 'Solo una promoción de un cliente lleva cliente.';
  }

  if (
    r.compraTipo === 'cualquiera' &&
    (r.compraProductoId || r.compraPresentacionId)
  ) {
    return 'Una compra de cualquier producto no lleva producto ni presentación.';
  }
  if (
    r.compraTipo === 'producto' &&
    (!r.compraProductoId || r.compraPresentacionId)
  ) {
    return 'Elige el producto que se compra.';
  }
  if (
    r.compraTipo === 'presentacion' &&
    (!r.compraPresentacionId || r.compraProductoId)
  ) {
    return 'Elige la presentación que se compra.';
  }

  if (r.regaloTipo === 'mismo') {
    if (r.compraTipo === 'cualquiera') {
      return 'Si la compra es de cualquier producto, el regalo tiene que ser un producto o una presentación concretos.';
    }
    if (r.regaloProductoId || r.regaloPresentacionId) {
      return 'Un regalo "del mismo" no lleva producto ni presentación.';
    }
  }
  if (
    r.regaloTipo === 'producto' &&
    (!r.regaloProductoId || r.regaloPresentacionId)
  ) {
    return 'Elige el producto que se regala.';
  }
  if (
    r.regaloTipo === 'presentacion' &&
    (!r.regaloPresentacionId || r.regaloProductoId)
  ) {
    return 'Elige la presentación que se regala.';
  }

  if (!Number.isInteger(r.compraCantidad) || r.compraCantidad < 0) {
    return 'La cantidad de compra son piezas enteras.';
  }
  if (r.compraCantidad === 0 && r.audiencia !== 'prospecto') {
    return 'La cantidad de compra debe ser al menos 1; solo la promoción de prospectos puede regalar sin compra.';
  }
  if (!Number.isInteger(r.regaloCantidad) || r.regaloCantidad < 1) {
    return 'Se regala al menos 1 pieza.';
  }
  return null;
}

/** D5: una propia desplaza a una general si coinciden en al menos un producto. */
export function coincidenEnProducto(a: Cobertura, b: Cobertura): boolean {
  if (a === 'todos' || b === 'todos') return true;
  for (const p of a) if (b.has(p)) return true;
  return false;
}
