import { apiFetch } from "./api";
import type { Producto } from "./productos";

// Copia normativa de las formas de
// apps/backend/src/modules/cartera-clientes/promociones.repository.ts (`Promocion`) y de
// las funciones puras `textoPromocion` (promociones-texto.ts) y `problemaDeRegla`
// (reglas-promocion.ts). El portal no puede importar del backend: un cambio de forma o de
// frase en un lado exige el equivalente en el otro. Las pruebas de ambos lados cubren los
// mismos casos.

export type AudienciaPromocion = "todos" | "cliente" | "prospecto";
export type CompraPromocion = "cualquiera" | "producto" | "presentacion";
export type RegaloPromocion = "mismo" | "producto" | "presentacion";

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

/** La regla, ya en camelCase, solo lo que necesita la frase. */
export interface ReglaPromocion {
  audiencia: AudienciaPromocion;
  compraTipo: CompraPromocion;
  compraCantidad: number;
  regaloTipo: RegaloPromocion;
  regaloCantidad: number;
  seRepite: boolean;
}

/**
 * Los nombres ya resueltos: el del producto, o "producto volumen" de la presentacion. `null`
 * cuando no aplica (compra `cualquiera`, regalo `mismo`) o cuando no se pudo resolver.
 */
export interface NombresPromocion {
  compra: string | null;
  regalo: string | null;
}

/** Una promocion como la devuelve la API del portal (camelCase). `texto` lo pone el servidor. */
export interface Promocion extends ReglaCompleta {
  id: string;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
  clienteNombre: string | null;
  /** Nombre del producto, o "producto volumen"; `null` si no aplica. */
  compraNombre: string | null;
  regaloNombre: string | null;
  /** Producto que cubre la compra (el de la presentacion si es por presentacion); `null` = cualquiera. */
  compraProductoCubierto: string | null;
  texto: string;
  /** Solo en `GET ?clienteId=`: una general que una propia del cliente desplaza (D5). */
  desplazada?: boolean;
}

/** El cuerpo de `POST /promociones` (plano, como el DTO). */
export interface DatosPromocion {
  sucursalId?: string;
  audiencia: AudienciaPromocion;
  clienteId?: string;
  compraTipo: CompraPromocion;
  compraProductoId?: string;
  compraPresentacionId?: string;
  compraCantidad: number;
  regaloTipo: RegaloPromocion;
  regaloProductoId?: string;
  regaloPresentacionId?: string;
  regaloCantidad: number;
  seRepite: boolean;
}

export function listarPromociones(
  filtro: { sucursal: string | null } | { clienteId: string },
): Promise<Promocion[]> {
  const params = new URLSearchParams();
  if ("clienteId" in filtro) params.set("clienteId", filtro.clienteId);
  else if (filtro.sucursal) params.set("sucursal", filtro.sucursal);
  const query = params.toString();
  return apiFetch<Promocion[]>(query ? `/promociones?${query}` : "/promociones");
}

export function crearPromocion(datos: DatosPromocion): Promise<Promocion[]> {
  return apiFetch<Promocion[]>("/promociones", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

/** Solo se cambian la regla y `activo`; la sucursal, la audiencia y el cliente no se editan. */
export function editarPromocion(
  id: string,
  datos: Omit<DatosPromocion, "sucursalId" | "audiencia" | "clienteId"> & { activo: boolean },
): Promise<Promocion> {
  return apiFetch<Promocion>(`/promociones/${id}`, {
    method: "PATCH",
    body: JSON.stringify(datos),
  });
}

/**
 * La frase que ven la oficina y el vendedor, y la que se congela en la nota (T-74, D11, D12).
 * Una sola forma de decirlo en los tres lados: esta funcion esta DUPLICADA a proposito en la
 * tablet (`src/datos/promociones-reglas.ts`) y en el backend (`promociones-texto.ts`), con las
 * mismas pruebas, porque el portal no puede importar de ellos.
 *
 * - Se repite: "Por cada N X, M Y gratis". Una vez: "Al comprar N X, M Y gratis (una vez)".
 * - Compra `cualquiera`: "pieza" si N = 1, "N piezas de lo que sea" si no.
 * - Regalo `mismo`: el nombre de la compra.
 * - Prospecto: prefijo "Bienvenida al prospecto:" y sufijo "en su primera venta";
 *   con compra 0 no hay compra que nombrar.
 */
export function textoPromocion(regla: ReglaPromocion, nombres: NombresPromocion): string {
  const hueco = "(producto)";
  const compra =
    regla.compraTipo === "cualquiera"
      ? regla.compraCantidad === 1
        ? "pieza"
        : `${regla.compraCantidad} piezas de lo que sea`
      : `${regla.compraCantidad} ${nombres.compra ?? hueco}`;
  const regalo = `${regla.regaloCantidad} ${
    regla.regaloTipo === "mismo" ? (nombres.compra ?? hueco) : (nombres.regalo ?? hueco)
  } gratis`;

  if (regla.audiencia === "prospecto") {
    if (regla.compraCantidad === 0) {
      return `Bienvenida al prospecto: ${regalo} en su primera venta`;
    }
    return `Bienvenida al prospecto: al comprar ${compra}, ${regalo} en su primera venta`;
  }
  return regla.seRepite ? `Por cada ${compra}, ${regalo}` : `Al comprar ${compra}, ${regalo} (una vez)`;
}

/**
 * Lo que impide guardar la regla, en el espanol de la oficina, o `null`. Espejo de los `check`
 * de la migracion (ck_promocion_*), con mensaje: el 23514 de Postgres seria un 500 que nadie
 * entiende. Se usa para validar en vivo mientras se edita.
 */
export function problemaDeRegla(r: ReglaCompleta): string | null {
  if (r.audiencia === "cliente" && !r.clienteId) {
    return "Elige el cliente de la promoción.";
  }
  if (r.audiencia !== "cliente" && r.clienteId) {
    return "Solo una promoción de un cliente lleva cliente.";
  }
  // La bienvenida se da una sola vez: repetirla por bloques regalaria mas de lo que dice su frase.
  if (r.audiencia === "prospecto" && r.seRepite) {
    return "La promoción de prospectos se da una sola vez, en su primera venta.";
  }

  if (r.compraTipo === "cualquiera" && (r.compraProductoId || r.compraPresentacionId)) {
    return "Una compra de cualquier producto no lleva producto ni presentación.";
  }
  if (r.compraTipo === "producto" && (!r.compraProductoId || r.compraPresentacionId)) {
    return "Elige el producto que se compra.";
  }
  if (r.compraTipo === "presentacion" && (!r.compraPresentacionId || r.compraProductoId)) {
    return "Elige la presentación que se compra.";
  }

  if (r.regaloTipo === "mismo") {
    if (r.compraTipo === "cualquiera") {
      return "Si la compra es de cualquier producto, el regalo tiene que ser un producto o una presentación concretos.";
    }
    if (r.regaloProductoId || r.regaloPresentacionId) {
      return 'Un regalo "del mismo" no lleva producto ni presentación.';
    }
  }
  if (r.regaloTipo === "producto" && (!r.regaloProductoId || r.regaloPresentacionId)) {
    return "Elige el producto que se regala.";
  }
  if (r.regaloTipo === "presentacion" && (!r.regaloPresentacionId || r.regaloProductoId)) {
    return "Elige la presentación que se regala.";
  }

  if (!Number.isInteger(r.compraCantidad) || r.compraCantidad < 0) {
    return "La cantidad de compra son piezas enteras.";
  }
  if (r.compraCantidad === 0 && r.audiencia !== "prospecto") {
    return "La cantidad de compra debe ser al menos 1; solo la promoción de prospectos puede regalar sin compra.";
  }
  if (!Number.isInteger(r.regaloCantidad) || r.regaloCantidad < 1) {
    return "Se regala al menos 1 pieza.";
  }
  return null;
}

/** Resuelve los nombres de la regla a partir del catalogo de productos del portal. */
export function nombresDe(
  datos: Pick<
    DatosPromocion,
    "compraTipo" | "compraProductoId" | "compraPresentacionId" | "regaloTipo" | "regaloProductoId" | "regaloPresentacionId"
  >,
  productos: Producto[],
): NombresPromocion {
  const producto = (id?: string) => productos.find((p) => p.id === id)?.nombre ?? null;
  const presentacion = (id?: string) => {
    for (const p of productos) {
      const pr = p.presentaciones.find((x) => x.id === id);
      if (pr) return `${p.nombre} ${pr.volumen}`;
    }
    return null;
  };
  return {
    compra:
      datos.compraTipo === "producto"
        ? producto(datos.compraProductoId)
        : datos.compraTipo === "presentacion"
          ? presentacion(datos.compraPresentacionId)
          : null,
    regalo:
      datos.regaloTipo === "producto"
        ? producto(datos.regaloProductoId)
        : datos.regaloTipo === "presentacion"
          ? presentacion(datos.regaloPresentacionId)
          : null,
  };
}
