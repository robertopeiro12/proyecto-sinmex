/**
 * Reglas de la carga del vendedor (T-27 pieza 1), sin base ni Nest: las lineas
 * de un POST/PATCH, cuando una carga se puede editar, el armado de la rejilla del
 * portal y (Tarea 3) la respuesta del vendedor y la forma del pull.
 */

export const ESTADOS_CARGA = ['pendiente', 'aceptada', 'rechazada'] as const;
export type EstadoCarga = (typeof ESTADOS_CARGA)[number];

/** Piezas por linea: enteras de 1 a 99 999 (spec, POST /cargas). */
export const MAX_PIEZAS_LINEA = 99_999;
/** Tope de lineas: una carga tiene decenas; esto es para que un cuerpo absurdo sea 400. */
export const MAX_LINEAS_CARGA = 200;
/** El mismo 300 del check `carga.motivo_rechazo`. */
export const LARGO_MAX_MOTIVO_RECHAZO = 300;

export const MOTIVO_CARGA_ACEPTADA =
  'Una carga aceptada no se modifica: el vendedor ya la aceptó. Recarga la página.';
export const MOTIVO_CARGA_DE_OTRO_DIA = 'Solo se modifican las cargas de hoy.';
export const MOTIVO_CARGA_CAMBIO =
  'La carga cambió mientras la editabas; recarga la página.';

export interface LineaCarga {
  presentacionId: string;
  piezas: number;
}

/** Una carga leida de la base, ya con sus lineas. */
export interface FilaCarga {
  id: string;
  vendedorId: string;
  sucursalId: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  numero: number;
  estado: EstadoCarga;
  motivoRechazo: string | null;
  version: number;
  respondidaEn: Date | null;
  eliminada: boolean;
  lineas: LineaCarga[];
}

export interface PresentacionRejilla {
  id: string;
  productoNombre: string;
  volumen: string;
  /**
   * `false` = dada de baja (o su producto). Solo sale en la rejilla si una carga
   * del dia la trae; el portal no la ofrece al capturar.
   */
  activa: boolean;
}

export interface SucursalRejilla {
  id: string;
  codigo: string;
  nombre: string;
}

export interface CargaRejilla {
  id: string;
  numero: number;
  estado: EstadoCarga;
  motivoRechazo: string | null;
  version: number;
  respondidaEn: string | null;
  lineas: LineaCarga[];
}

export interface VendedorRejilla {
  id: string;
  nombre: string;
  cargas: CargaRejilla[];
}

/** `GET /cargas`: la rejilla de Produccion › Recarga. */
export interface Rejilla {
  fecha: string;
  sucursal: SucursalRejilla;
  presentaciones: PresentacionRejilla[];
  vendedores: VendedorRejilla[];
}

/** Ids en minusculas: Postgres compara `uuid` sin importar, pero el `Set` de la validacion si. */
export function normalizarLineas(lineas: readonly LineaCarga[]): LineaCarga[] {
  return lineas.map((l) => ({
    presentacionId: l.presentacionId.toLowerCase(),
    piezas: l.piezas,
  }));
}

/**
 * El 400 de unas lineas que no valen, o `null`. El DTO ya comprobo la forma
 * (uuid, entero); esto repite los topes y decide lo que necesita la base:
 * repetidas y activas. `lineas` ya normalizadas.
 */
export function validarLineas(
  lineas: readonly LineaCarga[],
  activas: ReadonlySet<string>,
): string | null {
  if (lineas.length === 0) return 'La carga necesita al menos un producto.';
  if (lineas.length > MAX_LINEAS_CARGA) {
    return `Una carga lleva hasta ${MAX_LINEAS_CARGA} productos.`;
  }
  const vistas = new Set<string>();
  for (const l of lineas) {
    if (
      !Number.isInteger(l.piezas) ||
      l.piezas < 1 ||
      l.piezas > MAX_PIEZAS_LINEA
    ) {
      return 'Las piezas son enteras, de 1 a 99 999.';
    }
    if (vistas.has(l.presentacionId))
      return 'Un producto viene dos veces en la carga.';
    vistas.add(l.presentacionId);
    if (!activas.has(l.presentacionId)) {
      return 'Uno de los productos no existe o está dado de baja.';
    }
  }
  return null;
}

/**
 * Por que una carga no se puede editar ni eliminar (409), o `null`.
 *
 * - Aceptada: nunca (D5). El inventario de la tablet no cambia por debajo; un
 *   error se corrige con otra recarga o en el corte (pieza 3).
 * - De otro dia: los dias anteriores son de solo lectura (D8).
 * - Con otra version: alguien la edito mientras tanto.
 */
export function motivoNoEditable(
  carga: Pick<FilaCarga, 'estado' | 'fecha' | 'version'>,
  hoy: string,
  version: number,
): string | null {
  if (carga.estado === 'aceptada') return MOTIVO_CARGA_ACEPTADA;
  if (carga.fecha !== hoy) return MOTIVO_CARGA_DE_OTRO_DIA;
  if (carga.version !== version) return MOTIVO_CARGA_CAMBIO;
  return null;
}

/**
 * `"500 ml"` → 500, `"1.5 L"` → 1500; `null` si el texto no es un volumen. El
 * catalogo guarda el volumen como texto libre (T-10), asi que ordenar por texto
 * pondria "1 L" antes que "500 ml".
 */
export function mililitros(volumen: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(ml|l|lt|lts|litro|litros)\s*$/i.exec(
    volumen,
  );
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return m[2].toLowerCase() === 'ml' ? n : n * 1000;
}

/**
 * Presentacion (volumen, de menor a mayor) y luego sabor (producto): el
 * criterio que T-10 dejo para "la pantalla de Recarga". Un volumen que no se
 * entiende va al final, por texto.
 */
export function ordenarPresentaciones(
  presentaciones: readonly PresentacionRejilla[],
): PresentacionRejilla[] {
  return [...presentaciones].sort((a, b) => {
    const ma = mililitros(a.volumen);
    const mb = mililitros(b.volumen);
    if (ma !== null && mb === null) return -1;
    if (ma === null && mb !== null) return 1;
    if (ma !== null && mb !== null && ma !== mb) return ma - mb;
    if (ma === null && mb === null) {
      const porTexto = a.volumen.localeCompare(b.volumen, 'es');
      if (porTexto !== 0) return porTexto;
    }
    return (
      a.productoNombre.localeCompare(b.productoNombre, 'es') ||
      a.id.localeCompare(b.id)
    );
  });
}

export function aCargaRejilla(f: FilaCarga): CargaRejilla {
  return {
    id: f.id,
    numero: f.numero,
    estado: f.estado,
    motivoRechazo: f.motivoRechazo,
    version: f.version,
    respondidaEn: f.respondidaEn === null ? null : f.respondidaEn.toISOString(),
    lineas: f.lineas,
  };
}

/**
 * La rejilla: presentaciones en su orden, vendedores en orden alfabetico y, en
 * cada uno, sus cargas vivas por numero. Una carga de un vendedor que no viene
 * en la lista no se pinta (el repositorio ya trae a los que tienen cargas ese
 * dia aunque esten desactivados).
 */
export function armarRejilla(entrada: {
  fecha: string;
  sucursal: SucursalRejilla;
  presentaciones: readonly PresentacionRejilla[];
  vendedores: readonly { id: string; nombre: string }[];
  cargas: readonly FilaCarga[];
}): Rejilla {
  const porVendedor = new Map<string, FilaCarga[]>();
  for (const c of entrada.cargas) {
    if (c.eliminada) continue;
    const lista = porVendedor.get(c.vendedorId) ?? [];
    lista.push(c);
    porVendedor.set(c.vendedorId, lista);
  }
  return {
    fecha: entrada.fecha,
    sucursal: entrada.sucursal,
    presentaciones: ordenarPresentaciones(entrada.presentaciones),
    vendedores: [...entrada.vendedores]
      .sort(
        (a, b) =>
          a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id),
      )
      .map((v) => ({
        id: v.id,
        nombre: v.nombre,
        cargas: (porVendedor.get(v.id) ?? [])
          .sort((a, b) => a.numero - b.numero)
          .map(aCargaRejilla),
      })),
  };
}
