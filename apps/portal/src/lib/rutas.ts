import { apiFetch, apiFetchSinCuerpo } from "./api";
import type { ClienteResumen } from "./clientes";
import type { ClienteDeRutaSemanal } from "./rutas-semanales";
import { normalizarTexto } from "./ventas";

// Copia normativa de las formas de
// apps/backend/src/modules/rutas/rutas-diarias.service.ts (`RutaDiaria`, `RenglonDia`,
// `ListaDelDia`, `OpcionesDia`) y rutas-diarias.repository.ts (`FilaRutaDiaria`,
// `OrigenRuta`). Mismo trato que lib/cobranzas.ts: un cambio de forma en un lado exige el
// equivalente en el otro.

/** `semanal` = llegó de la Ruta Semanal; `oficina` = puesto a mano en el portal; `vendedor` = desde la tablet. */
export type OrigenRuta = "oficina" | "vendedor" | "semanal";

export interface FilaRutaDiaria {
  id: string;
  clienteId: string;
  clienteNombre: string;
  orden: number;
  origen: OrigenRuta;
  /** Lo que la oficina le dice al vendedor de ese cliente, o `null`. */
  recado: string | null;
  /** Notas de ese cliente asignadas a este vendedor ese día (vivas). */
  notasAsignadas: number;
}

/** `GET`/`PUT /rutas/diaria`: la ruta de un vendedor y día (spec §5.2). */
export interface RutaDiaria {
  vendedor: { id: string; nombre: string; sucursalCodigo: string };
  fecha: string;
  /** `false` = un día que ya pasó (de Tijuana): solo lectura. */
  editable: boolean;
  /** `null` = "Sin ruta". El nombre es el congelado al asignarla. */
  rutaSemanal: { id: string; nombre: string } | null;
  vehiculo: { id: string; nombre: string } | null;
  filas: FilaRutaDiaria[];
}

/** Un renglón de la lista del día (spec §5.1): un vendedor activo. */
export interface RenglonDia {
  vendedorId: string;
  vendedor: string;
  sucursalCodigo: string;
  /** `null` = "Sin ruta". */
  rutaNombre: string | null;
  clientes: number;
  /** Notas con saldo de los clientes de su ruta. */
  notasPendientes: number;
  /** Notas asignadas a él ese día (vivas), tengan saldo o no. */
  notasAsignadas: number;
  vehiculo: string | null;
  /** Hay encabezado o clientes vivos ese día. */
  tieneRuta: boolean;
}

/** `GET /rutas/diaria/dia`. */
export interface ListaDelDia {
  fecha: string;
  editable: boolean;
  renglones: RenglonDia[];
}

/** `GET /rutas/diaria/opciones`: las rutas semanales del día de la semana y los vehículos de la sucursal. */
export interface OpcionesDia {
  rutas: { id: string; nombre: string; ocupadaPor: string | null }[];
  vehiculos: { id: string; nombre: string; ocupadoPor: string | null }[];
}

/** Tope del recado (el mismo `MAX_RECADO` del backend). */
export const MAX_RECADO = 200;

/** Una fila de la lista mientras se edita (sin guardar). */
export interface FilaEditable {
  clienteId: string;
  clienteNombre: string;
  origen: OrigenRuta;
  recado: string | null;
  notasAsignadas: number;
}

/** Lo que se edita de la ruta de un vendedor: lo mismo que manda "Guardar". */
export interface RutaEditable {
  rutaSemanalId: string | null;
  vehiculoId: string | null;
  filas: FilaEditable[];
}

const porVendedorYFecha = (vendedorId: string, fecha: string) => new URLSearchParams({ vendedorId, fecha }).toString();

export function obtenerDia(fecha: string, sucursal: string): Promise<ListaDelDia> {
  return apiFetch<ListaDelDia>(`/rutas/diaria/dia?${new URLSearchParams({ fecha, sucursal }).toString()}`);
}

export function obtenerRutaDiaria(vendedorId: string, fecha: string): Promise<RutaDiaria> {
  return apiFetch<RutaDiaria>(`/rutas/diaria?${porVendedorYFecha(vendedorId, fecha)}`);
}

export function obtenerOpciones(vendedorId: string, fecha: string): Promise<OpcionesDia> {
  return apiFetch<OpcionesDia>(`/rutas/diaria/opciones?${porVendedorYFecha(vendedorId, fecha)}`);
}

/** Semántica de reemplazo: la ruta COMPLETA (ruta semanal, vehículo y clientes en orden con su recado). */
export function guardarRutaDiaria(datos: {
  vendedorId: string;
  fecha: string;
  rutaSemanalId: string | null;
  vehiculoId: string | null;
  clientes: { clienteId: string; recado: string | null }[];
}): Promise<RutaDiaria> {
  return apiFetch<RutaDiaria>("/rutas/diaria", { method: "PUT", body: JSON.stringify(datos) });
}

/** "Quitar ruta": baja la ruta del día del vendedor; lo que agregó el vendedor se queda. */
export function quitarRutaDiaria(vendedorId: string, fecha: string): Promise<void> {
  return apiFetchSinCuerpo(`/rutas/diaria?${porVendedorYFecha(vendedorId, fecha)}`, { method: "DELETE" });
}

export function aEditable(ruta: RutaDiaria): RutaEditable {
  return {
    rutaSemanalId: ruta.rutaSemanal?.id ?? null,
    vehiculoId: ruta.vehiculo?.id ?? null,
    filas: ruta.filas.map(({ clienteId, clienteNombre, origen, recado, notasAsignadas }) => ({
      clienteId,
      clienteNombre,
      origen,
      recado,
      notasAsignadas,
    })),
  };
}

/** Mueve una fila. Fuera de rango devuelve la MISMA lista (React no repinta). */
export function moverFila(filas: FilaEditable[], desde: number, hasta: number): FilaEditable[] {
  if (desde < 0 || desde >= filas.length || hasta < 0 || hasta >= filas.length) return filas;
  const copia = [...filas];
  const [movida] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movida);
  return copia;
}

/** El portal no puede quitar lo que agregó el vendedor (T-37): solo reordenarlo. */
export function quitarFila(filas: FilaEditable[], indice: number): FilaEditable[] {
  const fila = filas[indice];
  if (!fila || fila.origen === "vendedor") return filas;
  return filas.filter((_, i) => i !== indice);
}

export function agregarFila(filas: FilaEditable[], cliente: { id: string; nombre: string }): FilaEditable[] {
  if (filas.some((f) => f.clienteId === cliente.id)) return filas;
  return [
    ...filas,
    { clienteId: cliente.id, clienteNombre: cliente.nombre, origen: "oficina", recado: null, notasAsignadas: 0 },
  ];
}

/** El recado recortado; vacío = `null`. Más de `MAX_RECADO` caracteres no se acepta (misma lista). */
export function fijarRecado(filas: FilaEditable[], indice: number, texto: string): FilaEditable[] {
  const recortado = texto.trim();
  if (!filas[indice] || recortado.length > MAX_RECADO) return filas;
  const recado = recortado === "" ? null : recortado;
  return filas.map((f, i) => (i === indice ? { ...f, recado } : f));
}

/**
 * Escoger (o cambiar) la ruta semanal: salen los clientes que llegaron de la semanal
 * anterior y entran los de la nueva en su orden, antes de los puestos a mano (oficina o
 * vendedor), que se quedan. Un cliente que ya no es válido no se copia; uno que ya está
 * puesto a mano no se repite. Un cliente que sigue en la nueva conserva su recado.
 */
export function aplicarRutaSemanal(filas: FilaEditable[], clientesDeLaSemanal: ClienteDeRutaSemanal[]): FilaEditable[] {
  const aMano = filas.filter((f) => f.origen !== "semanal");
  const yaPuestos = new Set(aMano.map((f) => f.clienteId));
  const anteriores = new Map(filas.filter((f) => f.origen === "semanal").map((f) => [f.clienteId, f]));
  const nuevas: FilaEditable[] = [];
  for (const c of clientesDeLaSemanal) {
    if (!c.valido || yaPuestos.has(c.clienteId) || nuevas.some((f) => f.clienteId === c.clienteId)) continue;
    nuevas.push(
      anteriores.get(c.clienteId) ?? {
        clienteId: c.clienteId,
        clienteNombre: c.nombre,
        origen: "semanal",
        recado: null,
        notasAsignadas: 0,
      },
    );
  }
  return [...nuevas, ...aMano];
}

/** ¿Lo editado ya no es lo guardado? Cuenta ruta, vehículo, orden y recados. */
export function hayCambios(original: RutaEditable, actual: RutaEditable): boolean {
  return (
    original.rutaSemanalId !== actual.rutaSemanalId ||
    original.vehiculoId !== actual.vehiculoId ||
    original.filas.length !== actual.filas.length ||
    original.filas.some((f, i) => f.clienteId !== actual.filas[i].clienteId || f.recado !== actual.filas[i].recado)
  );
}

/** La cartera que se ofrece: lo que no está ya en la ruta, buscando sin acentos. */
export function filtrarCartera(
  cartera: ClienteResumen[],
  enRuta: ReadonlySet<string>,
  busqueda: string,
): ClienteResumen[] {
  const q = normalizarTexto(busqueda.trim());
  return cartera.filter((c) => !enRuta.has(c.id) && (q === "" || normalizarTexto(c.nombre).includes(q)));
}

// Copia normativa de `NotaDeRuta` y `NotasDeRuta` de
// apps/backend/src/modules/rutas/reglas-notas-ruta.ts (spec §5.4).

/** Una nota por cobrar en la ventana de notas de una ruta del día. */
export interface NotaDeRuta {
  ventaNotaId: string;
  folio: string;
  clienteId: string;
  cliente: string;
  /** `AAAA-MM-DD`, la fecha de la venta. */
  fecha: string;
  saldoCentavos: number;
  diasAtraso: number;
  /** Quien la trae ese día, o `null`. */
  asignadaA: { vendedorId: string; nombre: string } | null;
}

export interface NotasDeRuta {
  /** Con saldo, de los clientes de su ruta. */
  pendientes: NotaDeRuta[];
  /** Las de este vendedor ese día, aunque ya no tengan saldo. */
  asignadas: NotaDeRuta[];
}

export function obtenerNotas(vendedorId: string, fecha: string): Promise<NotasDeRuta> {
  return apiFetch<NotasDeRuta>(`/rutas/diaria/notas?${porVendedorYFecha(vendedorId, fecha)}`);
}

/** Asigna (o le pasa) la nota al vendedor ese día. Regresa las dos listas ya actualizadas. */
export function asignarNota(ventaNotaId: string, vendedorId: string, fecha: string): Promise<NotasDeRuta> {
  return apiFetch<NotasDeRuta>(`/rutas/diaria/notas/${ventaNotaId}`, {
    method: "PUT",
    body: JSON.stringify({ vendedorId, fecha }),
  });
}

export function quitarNota(ventaNotaId: string, vendedorId: string, fecha: string): Promise<NotasDeRuta> {
  return apiFetch<NotasDeRuta>(`/rutas/diaria/notas/${ventaNotaId}?${porVendedorYFecha(vendedorId, fecha)}`, {
    method: "DELETE",
  });
}

/** Buscar por folio, sin mayúsculas ni acentos. Vacío = la misma lista. */
export function filtrarPorFolio(notas: NotaDeRuta[], texto: string): NotaDeRuta[] {
  const q = normalizarTexto(texto.trim());
  return q === "" ? notas : notas.filter((n) => normalizarTexto(n.folio).includes(q));
}
