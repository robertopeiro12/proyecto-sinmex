import { apiFetch, apiFetchBlob } from "./api";
import type { TipoEgreso } from "./campos-egreso";

/*
 * Finanzas › Gastos (T-30/T-31, D10). Misma forma que `ListaGastos` de
 * apps/backend/src/modules/compras-egresos/gastos.service.ts (el portal no puede
 * importar del backend). Dinero en centavos enteros.
 */

export const PERMISO_VER_GASTOS = "gasto.ver";

export interface GastoListado {
  id: string;
  /** `AAAA-MM-DD`: el día de Tijuana al que cuenta (el `fecha_operacion` de la tablet). */
  fecha: string;
  /** ISO: cuándo lo guardó el vendedor. La hora se pinta en Tijuana. */
  registradoEn: string;
  sucursalCodigo: string;
  /** `null` = compra de oficina (siguiente ticket). */
  vendedorId: string | null;
  vendedorNombre: string | null;
  campoEgresoId: string;
  /** Copia del nombre al registrarlo: si la oficina renombra el campo, el gasto conserva el suyo. */
  campoNombre: string;
  tipo: TipoEgreso;
  montoCentavos: number;
  comentario: string | null;
  tieneFoto: boolean;
}

export interface ListaGastos {
  desde: string;
  hasta: string;
  gastos: GastoListado[];
  totalCentavos: number;
}

export function obtenerGastos(f: {
  desde: string;
  hasta: string;
  /** Código, `todas`, o null: lo decide el servidor (`resolverAlcance`). */
  sucursal: string | null;
  /** Id de vendedor o null (todos). */
  vendedor: string | null;
  /** Id de campo de egreso o null (todos). */
  campo: string | null;
}): Promise<ListaGastos> {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.sucursal) q.set("sucursal", f.sucursal);
  if (f.vendedor) q.set("vendedor", f.vendedor);
  if (f.campo) q.set("campo", f.campo);
  return apiFetch<ListaGastos>(`/gastos?${q.toString()}`);
}

/** Los bytes del ticket. Con `fetch` y no con `<img src>`: ver `FotoProspecto`. */
export function descargarFotoGasto(id: string): Promise<Blob> {
  return apiFetchBlob(`/gastos/${id}/foto`);
}

/** `HH:mm` en Tijuana: la oficina lee la hora del vendedor, no la de su navegador. */
export function horaEnTijuana(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Tijuana",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function etiquetaVendedorGasto(g: Pick<GastoListado, "vendedorNombre">): string {
  return g.vendedorNombre ?? "Oficina";
}
