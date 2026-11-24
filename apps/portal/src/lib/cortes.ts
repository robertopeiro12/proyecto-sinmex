import { apiFetch } from "./api";
import { formatearDiaLargo } from "./formato";
import { leerPiezas } from "./produccion";
import type { Producto } from "./productos";

// Copia normativa de `CortesDelDia`, `CorteVendedor`, `FilaCorte` y `LineaCortePantalla`
// en apps/backend/src/modules/produccion/cortes.service.ts, y de `TotalesCorte`,
// `claveTamano`, `mililitros`, `compararTamano` y `faltanteDelDia` en
// apps/backend/src/modules/produccion/reglas-corte.ts. El portal no importa del
// backend: un cambio de forma en un lado exige el equivalente en el otro. Spec:
// docs/superpowers/specs/2026-11-18-corte-por-tamano-y-merma-design.md (base:
// 2026-11-12-corte-de-mercancia-design.md §5).

export type EstadoCorte = "sin_corte" | "hecho" | "con_faltante";

/** Un vendedor en la lista del día (`GET /cortes`). */
export interface FilaCorte {
  vendedor: { id: string; nombre: string };
  sucursal: { id: string; codigo: string };
  piezasCargadas: number;
  estado: EstadoCorte;
  /** No tiene ninguna carga aceptada ese día (vendió con una carga sin aceptar o sin capturar). */
  sinCarga: boolean;
  /** Faltante del día por tamaño (D1); `null` si el corte no está hecho. */
  piezasFaltantes: number | null;
  /** Lo mismo para la merma (D1); `null` si el corte no está hecho. */
  mermaFaltante: number | null;
  hechoEn: string | null;
}

export interface CortesDelDia {
  fecha: string;
  /** Hoy de Tijuana según el servidor. */
  hoy: string;
  /** Ordenados por sucursal y nombre. */
  vendedores: FilaCorte[];
}

/** Una presentación del corte. */
export interface LineaCorte {
  presentacionId: string;
  /** Producto + tamaño ("Horchata 1 L"). */
  nombre: string;
  producto: string;
  volumen: string;
  cargadas: number;
  vendidas: number;
  regaladas: number;
  mermaEntregada: number;
  mermaRecibida: number;
  mermaAlmacen: number;
  consumo: number;
  cambiosEntregados: number;
  cambiosRecibidos: number;
  /** Piezas teóricas por regresar, sin recortar: negativo = vendió más de lo cargado. */
  deberiaRegresar: number;
  /** Lo contado y guardado (0 si no hay). */
  buenas: number;
  /** `null` si el corte no está hecho; < 0 = sobrante. */
  faltante: number | null;
  merma: number;
  /** Merma teórica por regresar (C4). */
  mermaTeorica: number;
  /** `null` si el corte no está hecho. */
  resultadoMerma: number | null;
}

export interface TotalesCorte {
  cargadas: number;
  vendidas: number;
  regaladas: number;
  mermaEntregada: number;
  mermaRecibida: number;
  mermaAlmacen: number;
  consumo: number;
  cambiosEntregados: number;
  cambiosRecibidos: number;
  deberiaRegresar: number;
  mermaTeorica: number;
  buenas: number;
  merma: number;
  /** Piezas que faltan (D1): suma por tamaño de los totales de tamaño positivos; `null` sin corte. */
  faltante: number | null;
  /** Lo mismo para la merma. */
  faltanteMerma: number | null;
}

/** `GET` y `PUT /cortes/vendedor`. */
export interface CorteVendedor {
  fecha: string;
  hoy: string;
  vendedor: { id: string; nombre: string };
  sucursal: { id: string; codigo: string };
  lineas: LineaCorte[];
  totales: TotalesCorte;
  /** Cuándo y quién (nombre del usuario) lo hizo; `null` = sin corte. */
  hecho: { en: string; por: string } | null;
}

export interface ConteoCorte {
  presentacionId: string;
  buenas: number;
  merma: number;
}

/** `sucursal`: código (`TJ`) o `null` = todas las que alcance el usuario. */
export function leerCortesDelDia(
  fecha: string,
  sucursal: string | null,
): Promise<CortesDelDia> {
  const params = new URLSearchParams({ fecha, sucursal: sucursal ?? "todas" });
  return apiFetch<CortesDelDia>(`/cortes?${params.toString()}`);
}

export function leerCorteVendedor(
  fecha: string,
  vendedor: string,
): Promise<CorteVendedor> {
  const params = new URLSearchParams({ fecha, vendedor });
  return apiFetch<CorteVendedor>(`/cortes/vendedor?${params.toString()}`);
}

/**
 * Reemplaza el conteo del día con TODAS las líneas (0/0 da de baja la presentación) y
 * deja el corte hecho, aunque no venga ninguna pieza.
 */
export function guardarCorteVendedor(datos: {
  fecha: string;
  vendedor: string;
  lineas: ConteoCorte[];
}): Promise<CorteVendedor> {
  return apiFetch<CorteVendedor>("/cortes/vendedor", {
    method: "PUT",
    body: JSON.stringify(datos),
  });
}

// ── Reglas de la pantalla (puras) ──────────────────────────────────────────────

/** La pastilla de estado de la lista: "Sin corte" gris, "Corte hecho", "Faltan N" rojo. */
export function etiquetaEstadoCorte(
  fila: Pick<FilaCorte, "estado" | "piezasFaltantes" | "mermaFaltante">,
): { texto: string; tono: "neutro" | "exito" | "error" } {
  if (fila.estado === "sin_corte")
    return { texto: "Sin corte", tono: "neutro" };
  if (fila.estado === "con_faltante") {
    const piezas = fila.piezasFaltantes ?? 0;
    const merma = fila.mermaFaltante ?? 0;
    if (piezas > 0 && merma > 0)
      return { texto: `Faltan ${piezas} · ${merma} de merma`, tono: "error" };
    if (merma > 0) return { texto: `Faltan ${merma} de merma`, tono: "error" };
    return { texto: `Faltan ${piezas}`, tono: "error" };
  }
  return { texto: "Corte hecho", tono: "exito" };
}

/** El estado de un corte ya leído, con la misma regla que la lista del servidor. */
export function estadoDeCorte(
  corte: Pick<CorteVendedor, "hecho" | "totales">,
): Pick<FilaCorte, "estado" | "piezasFaltantes" | "mermaFaltante"> {
  if (!corte.hecho)
    return { estado: "sin_corte", piezasFaltantes: null, mermaFaltante: null };
  const faltan = corte.totales.faltante ?? 0;
  const faltanMerma = corte.totales.faltanteMerma ?? 0;
  return {
    estado: faltan > 0 || faltanMerma > 0 ? "con_faltante" : "hecho",
    piezasFaltantes: faltan,
    mermaFaltante: faltanMerma,
  };
}

/** Clave del tamaño (D3): minúsculas y sin espacios. Normativa: `reglas-corte.ts` del backend. */
export function claveTamano(volumen: string): string {
  return volumen.toLowerCase().replace(/\s+/g, "");
}

/** Mililitros de un volumen; `null` si no se lee. Normativa: `reglas-corte.ts` del backend. */
export function mililitros(volumen: string): number | null {
  const m = /^(\d+(?:[.,]\d+)?)(ml|l|lt|lts|litro|litros)$/.exec(
    claveTamano(volumen),
  );
  if (!m) return null;
  const numero = Number(m[1].replace(",", "."));
  return m[2] === "ml" ? numero : numero * 1000;
}

/** Orden de tamaños (D3): por mililitros; lo ilegible al final, por texto. */
export function compararTamano(a: string, b: string): number {
  const ma = mililitros(a);
  const mb = mililitros(b);
  if (ma !== null && mb !== null) return ma - mb;
  if (ma !== null) return -1;
  if (mb !== null) return 1;
  return claveTamano(a).localeCompare(claveTamano(b), "es");
}

/**
 * Faltante del día (D1): dentro de un tamaño los resultados se compensan; entre
 * tamaños no. Suma por tamaño de max(0, suma con signo). Normativa: `reglas-corte.ts`.
 */
function faltanteDelDia(
  lineas: readonly { volumen: string; valor: number | null }[],
): number {
  const porTamano = new Map<string, number>();
  for (const l of lineas) {
    const clave = claveTamano(l.volumen);
    porTamano.set(clave, (porTamano.get(clave) ?? 0) + (l.valor ?? 0));
  }
  let total = 0;
  for (const suma of porTamano.values()) total += Math.max(0, suma);
  return total;
}

/** Lo guardado como texto del campo: vacío si no hay (nunca el teórico prellenado). */
export const textoConteo = (piezas: number) =>
  piezas > 0 ? String(piezas) : "";

/** Lo escrito en los campos, por presentación. */
export type BorradorCorte = Record<string, { buenas: string; merma: string }>;

export function borradorDeCorte(lineas: readonly LineaCorte[]): BorradorCorte {
  return Object.fromEntries(
    lineas.map((l) => [
      l.presentacionId,
      { buenas: textoConteo(l.buenas), merma: textoConteo(l.merma) },
    ]),
  );
}

/** Una línea vacía para una presentación agregada a mano (sin movimiento ese día). */
export function lineaAgregada(
  presentacionId: string,
  producto: string,
  volumen: string,
): LineaCorte {
  return {
    presentacionId,
    nombre: `${producto} ${volumen}`,
    producto,
    volumen,
    cargadas: 0,
    vendidas: 0,
    regaladas: 0,
    mermaEntregada: 0,
    mermaRecibida: 0,
    mermaAlmacen: 0,
    consumo: 0,
    cambiosEntregados: 0,
    cambiosRecibidos: 0,
    deberiaRegresar: 0,
    buenas: 0,
    faltante: null,
    merma: 0,
    mermaTeorica: 0,
    resultadoMerma: null,
  };
}

export interface FilaVistaCorte {
  linea: LineaCorte;
  /** Lo leído de los campos; `null` = no es un entero válido. Vacío = 0. */
  buenas: number | null;
  merma: number | null;
  /** Debería − buenas; `null` mientras no se muestra (corte sin hacer y renglón sin tocar) o con buenas inválidas. */
  faltante: number | null;
  /** Merma teórica − merma escrita; misma regla de visibilidad que `faltante`. */
  resultadoMerma: number | null;
}

/** Una sección de la tabla: todas las presentaciones de un tamaño. */
export interface GrupoVistaCorte {
  /** Volumen de la primera fila. */
  tamano: string;
  filas: FilaVistaCorte[];
  totales: {
    deberiaRegresar: number;
    buenas: number;
    /** Suma con signo de los visibles; `null` si ninguno se muestra. */
    faltante: number | null;
    mermaTeorica: number;
    merma: number;
    resultadoMerma: number | null;
  };
}

export interface VistaCorte {
  filas: FilaVistaCorte[];
  /** Por tamaño (`compararTamano`), dentro por producto. */
  grupos: GrupoVistaCorte[];
  totales: TotalesCorte;
  hayInvalidas: boolean;
  /** Algo de lo escrito difiere de lo guardado. */
  cambios: boolean;
  /** Buenas + merma escritas = 0 (el vendedor no regresó nada). */
  sinPiezas: boolean;
}

/**
 * La tabla del corte con lo que va escribiendo el almacenista. Con el corte hecho, el
 * faltante de cada renglón y el "Faltan N" del total se recalculan con lo escrito. Sin
 * corte, lo no contado no es un faltante (D9): solo los renglones que se tocaron en esta
 * captura (`tocadas`) muestran el suyo, como vista previa, y el total queda vacío hasta
 * guardar. Los totales de faltante suman solo los positivos, como el servidor.
 */
export function vistaCorte(
  lineas: readonly LineaCorte[],
  borrador: BorradorCorte,
  hecho: boolean,
  tocadas: ReadonlySet<string> = new Set(),
): VistaCorte {
  const leidas = lineas.map((l) => ({
    linea: l,
    buenas: leerPiezas(borrador[l.presentacionId]?.buenas ?? ""),
    merma: leerPiezas(borrador[l.presentacionId]?.merma ?? ""),
  }));
  const hayInvalidas = leidas.some(
    (f) => f.buenas === null || f.merma === null,
  );
  const cambios = leidas.some(
    (f) => f.buenas !== f.linea.buenas || f.merma !== f.linea.merma,
  );
  const filas: FilaVistaCorte[] = leidas.map((f) => {
    const visible = hecho || tocadas.has(f.linea.presentacionId);
    return {
      ...f,
      faltante:
        visible && f.buenas !== null
          ? f.linea.deberiaRegresar - f.buenas
          : null,
      resultadoMerma:
        visible && f.merma !== null ? f.linea.mermaTeorica - f.merma : null,
    };
  });
  const suma = (valor: (f: FilaVistaCorte) => number) =>
    filas.reduce((t, f) => t + valor(f), 0);
  const sumaVisible = (
    fs: FilaVistaCorte[],
    valor: (f: FilaVistaCorte) => number | null,
  ) => {
    const v = fs.map(valor).filter((x): x is number => x !== null);
    return v.length === 0 ? null : v.reduce((t, x) => t + x, 0);
  };
  const porClave = new Map<string, FilaVistaCorte[]>();
  for (const f of filas) {
    const clave = claveTamano(f.linea.volumen);
    porClave.set(clave, [...(porClave.get(clave) ?? []), f]);
  }
  const grupos: GrupoVistaCorte[] = [...porClave.values()]
    .map((fs) =>
      [...fs].sort((a, b) =>
        a.linea.producto.localeCompare(b.linea.producto, "es"),
      ),
    )
    .sort((a, b) => compararTamano(a[0].linea.volumen, b[0].linea.volumen))
    .map((fs) => ({
      tamano: fs[0].linea.volumen,
      filas: fs,
      totales: {
        deberiaRegresar: fs.reduce((t, f) => t + f.linea.deberiaRegresar, 0),
        buenas: fs.reduce((t, f) => t + (f.buenas ?? 0), 0),
        faltante: sumaVisible(fs, (f) => f.faltante),
        mermaTeorica: fs.reduce((t, f) => t + f.linea.mermaTeorica, 0),
        merma: fs.reduce((t, f) => t + (f.merma ?? 0), 0),
        resultadoMerma: sumaVisible(fs, (f) => f.resultadoMerma),
      },
    }));
  return {
    filas,
    grupos,
    totales: {
      cargadas: suma((f) => f.linea.cargadas),
      vendidas: suma((f) => f.linea.vendidas),
      regaladas: suma((f) => f.linea.regaladas),
      mermaEntregada: suma((f) => f.linea.mermaEntregada),
      mermaRecibida: suma((f) => f.linea.mermaRecibida),
      mermaAlmacen: suma((f) => f.linea.mermaAlmacen),
      consumo: suma((f) => f.linea.consumo),
      cambiosEntregados: suma((f) => f.linea.cambiosEntregados),
      cambiosRecibidos: suma((f) => f.linea.cambiosRecibidos),
      deberiaRegresar: suma((f) => f.linea.deberiaRegresar),
      mermaTeorica: suma((f) => f.linea.mermaTeorica),
      buenas: suma((f) => f.buenas ?? 0),
      merma: suma((f) => f.merma ?? 0),
      faltante: hecho
        ? faltanteDelDia(
            filas.map((f) => ({ volumen: f.linea.volumen, valor: f.faltante })),
          )
        : null,
      faltanteMerma: hecho
        ? faltanteDelDia(
            filas.map((f) => ({
              volumen: f.linea.volumen,
              valor: f.resultadoMerma,
            })),
          )
        : null,
    },
    hayInvalidas,
    cambios,
    sinPiezas: suma((f) => (f.buenas ?? 0) + (f.merma ?? 0)) === 0,
  };
}

/** Lo que se manda al guardar: todas las líneas de la tabla, vacío = 0. */
export function conteosDe(vista: VistaCorte): ConteoCorte[] {
  return vista.filas.map((f) => ({
    presentacionId: f.linea.presentacionId,
    buenas: f.buenas ?? 0,
    merma: f.merma ?? 0,
  }));
}

/** Presentaciones vivas (de productos activos) que todavía no están en la tabla, por nombre. */
export function presentacionesParaAgregar(
  productos: readonly Producto[],
  enTabla: readonly { presentacionId: string }[],
): { id: string; nombre: string; producto: string; volumen: string }[] {
  const ya = new Set(enTabla.map((l) => l.presentacionId));
  return productos
    .filter((p) => p.activo)
    .flatMap((p) =>
      p.presentaciones.map((pr) => ({
        id: pr.id,
        nombre: `${p.nombre} ${pr.volumen}`,
        producto: p.nombre,
        volumen: pr.volumen,
      })),
    )
    .filter((pr) => !ya.has(pr.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * "Hecho por Luis el jueves 12 de noviembre a las 12:58." `en` llega del servidor como
 * `AAAA-MM-DD hh:mm` en hora de Tijuana; si no trae esa forma se muestra tal cual.
 */
export function textoHecho(hecho: { en: string; por: string }): string {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(hecho.en);
  const cuando = m ? `el ${formatearDiaLargo(m[1])} a las ${m[2]}` : hecho.en;
  return `Hecho por ${hecho.por} ${cuando}.`;
}
