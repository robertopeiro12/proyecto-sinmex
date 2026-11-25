import type { CargaPull } from '../sincronizacion/contrato';

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

/**
 * Un renglon leido de la base (pieza 3): `aceptada` es la respuesta del
 * vendedor a ese renglon; `null` mientras la carga esta pendiente y en las
 * cargas respondidas antes de la pieza 3 (ver `renglonAceptado`).
 */
export interface LineaCargaLeida extends LineaCarga {
  aceptada: boolean | null;
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
  lineas: LineaCargaLeida[];
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

export interface LineaCargaRejilla extends LineaCarga {
  /** `null` = pendiente; si no, lo que el vendedor contesto a ese renglon. */
  aceptada: boolean | null;
}

export interface CargaRejilla {
  id: string;
  numero: number;
  estado: EstadoCarga;
  motivoRechazo: string | null;
  version: number;
  respondidaEn: string | null;
  /** Renglones que trae la carga. */
  renglones: number;
  /** `null` mientras esta pendiente. */
  renglonesAceptados: number | null;
  lineas: LineaCargaRejilla[];
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
  const pendiente = f.estado === 'pendiente';
  const lineas = f.lineas.map((l) => ({
    presentacionId: l.presentacionId,
    piezas: l.piezas,
    aceptada: pendiente ? null : renglonAceptado(f.estado, l),
  }));
  return {
    id: f.id,
    numero: f.numero,
    estado: f.estado,
    motivoRechazo: f.motivoRechazo,
    version: f.version,
    respondidaEn: f.respondidaEn === null ? null : f.respondidaEn.toISOString(),
    renglones: lineas.length,
    renglonesAceptados: pendiente
      ? null
      : lineas.filter((l) => l.aceptada).length,
    lineas,
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

export const MOTIVO_RESPUESTA_CONFLICTO =
  'La carga cambió en el almacén o ya tiene otra respuesta; sincroniza y revísala de nuevo.';

/**
 * Lo que el vendedor contesta, ya validado (pieza 3: por renglon). Con al menos
 * un renglon aceptado la carga queda `aceptada`; con ninguno, `rechazada`. El
 * motivo solo viene de la forma vieja (`rechazar`); la lista nunca lo lleva.
 */
export interface RespuestaCarga {
  estado: 'aceptada' | 'rechazada';
  /** Ids (minusculas) de las presentaciones aceptadas. */
  aceptadas: ReadonlySet<string>;
  motivo: string | null;
}

/**
 * El cuerpo de `POST /sync/cargas/:id/respuesta` sin la version: la forma
 * nueva (`aceptadas`) o la vieja (`accion` + `motivo`, tablets sin actualizar).
 * El DTO ya valido los tipos; aqui van las reglas entre campos.
 */
export interface CuerpoRespuesta {
  aceptadas?: readonly string[] | null;
  accion?: 'aceptar' | 'rechazar' | null;
  motivo?: string | null;
}

/**
 * La forma de la respuesta contra las presentaciones de la carga:
 *
 * - `aceptadas`: cada id debe ser de la carga y una sola vez (Review Focus 3);
 *   vacia rechaza sin motivo. No lleva `motivo` ni `accion`.
 * - Forma vieja (Review Focus 2): `aceptar` = todos los renglones, sin motivo
 *   (`null` cuenta como ausente); `rechazar` = ninguno, con 1..300 caracteres
 *   recortados.
 */
export function normalizarRespuesta(
  cuerpo: CuerpoRespuesta,
  presentacionesDeLaCarga: readonly string[],
): { ok: true; respuesta: RespuestaCarga } | { ok: false; mensaje: string } {
  const deLaCarga = new Set(
    presentacionesDeLaCarga.map((id) => id.toLowerCase()),
  );
  const tieneLista =
    cuerpo.aceptadas !== undefined && cuerpo.aceptadas !== null;
  const tieneAccion = cuerpo.accion !== undefined && cuerpo.accion !== null;
  const tieneMotivo = cuerpo.motivo !== undefined && cuerpo.motivo !== null;

  if (tieneLista && tieneAccion) {
    return {
      ok: false,
      mensaje: 'Manda la lista de aceptados o la acción, no las dos.',
    };
  }
  if (tieneLista) {
    if (tieneMotivo) {
      return { ok: false, mensaje: 'La lista de aceptados no lleva motivo.' };
    }
    const aceptadas = new Set<string>();
    for (const crudo of cuerpo.aceptadas!) {
      const id = crudo.toLowerCase();
      if (!deLaCarga.has(id)) {
        return {
          ok: false,
          mensaje: 'Uno de los productos aceptados no viene en esta carga.',
        };
      }
      if (aceptadas.has(id)) {
        return { ok: false, mensaje: 'Un producto aceptado viene repetido.' };
      }
      aceptadas.add(id);
    }
    return {
      ok: true,
      respuesta: {
        estado: aceptadas.size > 0 ? 'aceptada' : 'rechazada',
        aceptadas,
        motivo: null,
      },
    };
  }
  if (!tieneAccion) {
    return { ok: false, mensaje: 'Falta la lista de productos aceptados.' };
  }

  if (cuerpo.accion === 'aceptar') {
    if (tieneMotivo) {
      return { ok: false, mensaje: 'Aceptar una carga no lleva motivo.' };
    }
    return {
      ok: true,
      respuesta: { estado: 'aceptada', aceptadas: deLaCarga, motivo: null },
    };
  }
  const texto = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : '';
  if (texto.length < 1 || texto.length > LARGO_MAX_MOTIVO_RECHAZO) {
    return {
      ok: false,
      mensaje:
        'Para rechazar la carga escribe el motivo (hasta 300 caracteres).',
    };
  }
  return {
    ok: true,
    respuesta: { estado: 'rechazada', aceptadas: new Set(), motivo: texto },
  };
}

/**
 * ¿El renglon cuenta como aceptado? Con respuesta por renglon, lo que diga; en
 * una carga respondida antes de la pieza 3 (`null`), lo que diga la carga: una
 * aceptada vieja es "todo aceptado" (Review Focus 1), una rechazada, "nada".
 */
export function renglonAceptado(
  estado: EstadoCarga,
  linea: Pick<LineaCargaLeida, 'aceptada'>,
): boolean {
  return linea.aceptada ?? estado === 'aceptada';
}

export type DecisionRespuesta = 'escribir' | 'repetida' | 'conflicto';

/**
 * Que hacer con una respuesta sobre la carga YA bloqueada (`for update`):
 *
 * - `repetida`: ya tiene esa misma respuesta en esa version (reintento de red o
 *   doble toque): mismo estado, mismo motivo y el mismo conjunto de renglones
 *   aceptados. 200 sin reescribir.
 * - `conflicto`: otra version (el portal la edito) o ya no esta pendiente con
 *   otra respuesta: 409 con la carga actual.
 * - `escribir`: pendiente y con la version que vio el vendedor.
 */
export function decidirRespuesta(
  carga: Pick<FilaCarga, 'estado' | 'version' | 'motivoRechazo' | 'lineas'>,
  respuesta: RespuestaCarga,
  version: number,
): DecisionRespuesta {
  if (carga.version !== version) return 'conflicto';
  if (carga.estado === 'pendiente') return 'escribir';
  const yaAceptadas = carga.lineas
    .filter((l) => renglonAceptado(carga.estado, l))
    .map((l) => l.presentacionId.toLowerCase());
  const mismoConjunto =
    yaAceptadas.length === respuesta.aceptadas.size &&
    yaAceptadas.every((id) => respuesta.aceptadas.has(id));
  return carga.estado === respuesta.estado &&
    carga.motivoRechazo === respuesta.motivo &&
    mismoConjunto
    ? 'repetida'
    : 'conflicto';
}

/** Una fila de la coleccion `cargas` del pull (y la respuesta del endpoint de la app). */
export function aCargaPull(f: FilaCarga): CargaPull {
  return {
    id: f.id,
    vendedor_id: f.vendedorId,
    fecha: f.fecha,
    numero: f.numero,
    estado: f.estado,
    motivo_rechazo: f.motivoRechazo,
    version: f.version,
    respondida_en:
      f.respondidaEn === null ? null : f.respondidaEn.toISOString(),
    activo: f.eliminada ? 0 : 1,
    lineas: f.lineas.map((l) => ({
      presentacion_id: l.presentacionId,
      piezas: l.piezas,
      aceptada: l.aceptada,
    })),
  };
}
