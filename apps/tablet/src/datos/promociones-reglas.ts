/**
 * Promociones por regla (T-74): reglas puras, sin SQLite ni React, para que el
 * repositorio de la venta y la pantalla de captura apliquen exactamente lo mismo.
 */
import type { Cliente, Promocion } from './tipos';
import type { LineaCaptura } from './ventas-reglas';

export interface CatalogoPromociones {
  /** presentacion_id -> producto y etiqueta "Producto volumen", en el orden del catalogo. */
  presentaciones: ReadonlyMap<string, { productoId: string; etiqueta: string }>;
  /** producto_id -> nombre. */
  productos: ReadonlyMap<string, string>;
}

export interface PromocionAplicable extends Promocion {
  texto: string;
}

export interface Regalo {
  promocionId: string;
  texto: string;
  productoId: string;
  /** `null` = falta que el vendedor elija la presentacion (D16). */
  presentacionId: string | null;
  cantidad: number;
}

export type Cobertura = 'todos' | ReadonlySet<string>;

function nombreDe(p: Promocion, lado: 'compra' | 'regalo', catalogo: CatalogoPromociones): string | null {
  const tipo = lado === 'compra' ? p.compra_tipo : p.regalo_tipo;
  if (tipo === 'producto') {
    const id = lado === 'compra' ? p.compra_producto_id : p.regalo_producto_id;
    return (id && catalogo.productos.get(id)) ?? null;
  }
  if (tipo === 'presentacion') {
    const id = lado === 'compra' ? p.compra_presentacion_id : p.regalo_presentacion_id;
    return (id && catalogo.presentaciones.get(id)?.etiqueta) ?? null;
  }
  return null;
}

/**
 * La frase de la promocion. COPIA de `promociones-texto.ts` del backend (y de
 * `lib/promociones.ts` del portal): la tablet no puede importar del backend y
 * la frase tiene que ser la misma en los tres sitios, porque es la que se
 * congela en la nota.
 */
export function textoPromocion(p: Promocion, catalogo: CatalogoPromociones): string {
  // Un nombre que no esta en el catalogo deja un hueco visible en vez de reventar.
  const hueco = '(producto)';
  const nombreCompra = nombreDe(p, 'compra', catalogo);
  const compra =
    p.compra_tipo === 'cualquiera'
      ? p.compra_cantidad === 1
        ? 'pieza'
        : `${p.compra_cantidad} piezas de lo que sea`
      : `${p.compra_cantidad} ${nombreCompra ?? hueco}`;
  const regalo = `${p.regalo_cantidad} ${
    p.regalo_tipo === 'mismo' ? (nombreCompra ?? hueco) : (nombreDe(p, 'regalo', catalogo) ?? hueco)
  } gratis`;
  if (p.audiencia === 'prospecto') {
    return p.compra_cantidad === 0
      ? `Bienvenida al prospecto: ${regalo} en su primera venta`
      : `Bienvenida al prospecto: al comprar ${compra}, ${regalo} en su primera venta`;
  }
  return p.se_repite === 1 ? `Por cada ${compra}, ${regalo}` : `Al comprar ${compra}, ${regalo} (una vez)`;
}

/**
 * Los productos que cubre la compra de una promocion (D5). Una por presentacion
 * cubre su producto entero: el desplazamiento se decide por producto, no por envase.
 */
export function cobertura(p: Promocion, catalogo: CatalogoPromociones): Cobertura {
  if (p.compra_tipo === 'cualquiera') return 'todos';
  if (p.compra_tipo === 'producto') return new Set(p.compra_producto_id ? [p.compra_producto_id] : []);
  const pres = p.compra_presentacion_id ? catalogo.presentaciones.get(p.compra_presentacion_id) : undefined;
  return new Set(pres ? [pres.productoId] : []);
}

export function coincidenEnProducto(a: Cobertura, b: Cobertura): boolean {
  if (a === 'todos' || b === 'todos') return true;
  for (const p of a) if (b.has(p)) return true;
  return false;
}

/**
 * Que promociones le tocan a este cliente hoy (D5, D7): sus propias, las
 * generales que ninguna propia desplaza, y la de bienvenida si es un prospecto
 * sin primera venta (ni en el servidor ni en esta tablet: la venta local aun
 * no subida no ha llenado `primera_venta_en`).
 */
export function promocionesAplicables({
  cliente,
  tieneVentas,
  promociones,
  catalogo,
}: {
  cliente: Pick<Cliente, 'id' | 'tipo' | 'primera_venta_en'>;
  tieneVentas: boolean;
  promociones: readonly Promocion[];
  catalogo: CatalogoPromociones;
}): PromocionAplicable[] {
  // Una inactiva se conserva en la base pero ni se aplica ni desplaza a nadie.
  const activas = promociones.filter((p) => p.activo === 1);
  const propias = activas.filter((p) => p.audiencia === 'cliente' && p.cliente_id === cliente.id);
  const generales = activas.filter(
    (p) =>
      p.audiencia === 'todos' &&
      !propias.some((q) => coincidenEnProducto(cobertura(q, catalogo), cobertura(p, catalogo))),
  );
  const esPrimeraVenta = cliente.tipo === 'prospecto' && cliente.primera_venta_en === null && !tieneVentas;
  const bienvenida = esPrimeraVenta ? activas.filter((p) => p.audiencia === 'prospecto') : [];
  return [...propias, ...generales, ...bienvenida].map((p) => ({ ...p, texto: textoPromocion(p, catalogo) }));
}

/** Un campo a medio capturar puede llegar como NaN: cuenta como 0, nunca revienta. */
const piezas = (n: number) => (Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);

/**
 * Piezas compradas que cuentan para la promocion. Solo `cantidad`: lo regalado
 * (`cantidadPromocion`) no es compra (D18), y una misma pieza cuenta para cada
 * promocion que la cubra.
 */
function compradas(p: Promocion, lineas: readonly LineaCaptura[], catalogo: CatalogoPromociones): number {
  let total = 0;
  for (const l of lineas) {
    const pres = catalogo.presentaciones.get(l.presentacionId);
    if (!pres) continue;
    const cuenta =
      p.compra_tipo === 'cualquiera' ||
      (p.compra_tipo === 'producto' && pres.productoId === p.compra_producto_id) ||
      (p.compra_tipo === 'presentacion' && l.presentacionId === p.compra_presentacion_id);
    if (cuenta) total += piezas(l.cantidad);
  }
  return total;
}

/** La presentacion del producto con mas piezas compradas; empate: la primera del catalogo (D16). */
function masComprada(
  productoId: string,
  lineas: readonly LineaCaptura[],
  catalogo: CatalogoPromociones,
): string | null {
  let mejor: { id: string; cantidad: number } | null = null;
  for (const [id, pres] of catalogo.presentaciones) {
    if (pres.productoId !== productoId) continue;
    const cantidad = piezas(lineas.find((l) => l.presentacionId === id)?.cantidad ?? 0);
    // Estrictamente mayor: en empate se queda la que aparecio antes en el catalogo.
    if (mejor === null || cantidad > mejor.cantidad) mejor = { id, cantidad };
  }
  return mejor?.id ?? null;
}

/** Las presentaciones de un producto en el catalogo, en su orden. */
function presentacionesDe(productoId: string, catalogo: CatalogoPromociones): string[] {
  return [...catalogo.presentaciones].filter(([, p]) => p.productoId === productoId).map(([id]) => id);
}

/**
 * Los regalos que se ganan con lo capturado, uno por promocion (dos promociones
 * a la misma presentacion dan dos regalos; se suman al aplicarlos). Un regalo
 * que apunta a algo que ya no esta en el catalogo se omite: no se puede entregar.
 */
export function calcularRegalos(
  lineas: readonly LineaCaptura[],
  promociones: readonly PromocionAplicable[],
  catalogo: CatalogoPromociones,
  elecciones: ReadonlyMap<string, string>,
): Regalo[] {
  const regalos: Regalo[] = [];
  for (const p of promociones) {
    // Cuantos bloques (D2). Compra 0 (prospecto): un bloque sin mirar la compra.
    let bloques: number;
    if (p.compra_cantidad === 0) {
      bloques = 1;
    } else {
      const n = compradas(p, lineas, catalogo);
      bloques = p.se_repite === 1 ? Math.floor(n / p.compra_cantidad) : n >= p.compra_cantidad ? 1 : 0;
    }
    if (bloques === 0) continue;

    // Que se regala y en que presentacion (D16).
    let productoId: string | null;
    let presentacionId: string | null;
    if (p.regalo_tipo === 'presentacion') {
      const pres = p.regalo_presentacion_id ? catalogo.presentaciones.get(p.regalo_presentacion_id) : undefined;
      if (!pres) continue;
      productoId = pres.productoId;
      presentacionId = p.regalo_presentacion_id;
    } else if (p.regalo_tipo === 'producto') {
      productoId = p.regalo_producto_id;
      if (!productoId || !catalogo.productos.has(productoId)) continue;
      const opciones = presentacionesDe(productoId, catalogo);
      if (opciones.length === 0) continue;
      // Solo aqui hay algo que elegir: con una sola presentacion no se le pregunta al vendedor.
      const elegida = elecciones.get(p.id);
      presentacionId =
        elegida && opciones.includes(elegida) ? elegida : opciones.length === 1 ? (opciones[0] ?? null) : null;
    } else {
      // 'mismo': el producto de la compra; la presentacion comprada o la que mas compro.
      if (p.compra_tipo === 'presentacion') {
        const pres = p.compra_presentacion_id ? catalogo.presentaciones.get(p.compra_presentacion_id) : undefined;
        if (!pres) continue;
        productoId = pres.productoId;
        presentacionId = p.compra_presentacion_id;
      } else {
        productoId = p.compra_producto_id;
        if (!productoId) continue;
        presentacionId = masComprada(productoId, lineas, catalogo);
        if (presentacionId === null) continue;
      }
    }
    if (productoId === null) continue;
    regalos.push({ promocionId: p.id, texto: p.texto, productoId, presentacionId, cantidad: bloques * p.regalo_cantidad });
  }
  return regalos;
}

/**
 * Lleva los regalos a las lineas: `cantidadPromocion` de cada una es la suma de
 * sus regalos (se recalcula entera, nunca se acumula sobre lo que traia). El
 * vendedor solo puede quitar un regalo (D6), nunca agregar ni cambiar cantidades.
 */
export function aplicarRegalos(
  lineas: readonly LineaCaptura[],
  regalos: readonly Regalo[],
  descartados: ReadonlySet<string>,
): { lineas: LineaCaptura[]; regalos: Regalo[] } {
  const aplicados = regalos.filter((r) => !descartados.has(r.promocionId));
  const porPresentacion = new Map<string, number>();
  for (const r of aplicados) {
    // Sin presentacion no se sabe a que linea va; se devuelve igual para que la pantalla la pida.
    if (r.presentacionId === null) continue;
    porPresentacion.set(r.presentacionId, (porPresentacion.get(r.presentacionId) ?? 0) + r.cantidad);
  }
  const resultado = lineas.map((l) => ({ ...l, cantidadPromocion: porPresentacion.get(l.presentacionId) ?? 0 }));
  // El regalo del prospecto sin compra puede caer en una presentacion sin linea:
  // la pantalla pasa todo el catalogo como base, pero la regla no depende de eso.
  const conLinea = new Set(lineas.map((l) => l.presentacionId));
  for (const [presentacionId, cantidadPromocion] of porPresentacion) {
    if (conLinea.has(presentacionId)) continue;
    resultado.push({ presentacionId, etiqueta: '', cantidad: 0, cantidadPromocion, precioCentavos: null });
  }
  return { lineas: resultado, regalos: aplicados };
}

/** Los regalos de producto completo que aun esperan la presentacion del vendedor (D16). */
export function problemasDeRegalos(regalos: readonly Regalo[]): string[] {
  return regalos
    .filter((r) => r.presentacionId === null)
    .map((r) => `Elige la presentación del regalo de «${r.texto}».`);
}
