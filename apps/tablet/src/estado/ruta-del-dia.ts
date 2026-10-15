import type { FilaRutaDelDia } from '@/datos/repositorios/rutas';
import type { Cliente, Prospecto, SyncEstado, Venta } from '@/datos/tipos';
import { formatearMomento } from '@/ui/momento';

/**
 * Lo que la pantalla principal decide (T-37, D16), sin React: la tablet no tiene
 * pruebas de pantalla, asi que todo lo que se pueda fijar con una prueba vive
 * aqui (mismo criterio que `menu-jornada.ts`, T-38).
 */

/** Lo minimo que `agruparRuta` necesita de una fila. */
export type FilaAgrupable = Pick<FilaRutaDelDia, 'cliente_id' | 'activo' | 'visitado'>;

/**
 * Reparte las filas del dia (ya ordenadas por `rutas.delDia`) entre la ruta y
 * "Fuera de ruta" (D5, D16):
 *
 * - Viva → en la ruta, visitada o no (la palomita no la saca de la lista).
 * - Quitada por la oficina **con** actividad hoy → "Fuera de ruta": el vendedor
 *   fue, y eso es informacion para la efectividad.
 * - Quitada **sin** actividad → desaparece.
 * - Si el cliente quitado volvio a la ruta (otra fila viva), no se pinta dos veces.
 */
export function agruparRuta<T extends FilaAgrupable>(
  filas: readonly T[],
): { enRuta: T[]; fueraDeRuta: T[] } {
  const vivos = new Set(filas.filter((f) => f.activo === 1).map((f) => f.cliente_id));
  return {
    enRuta: filas.filter((f) => f.activo === 1),
    fueraDeRuta: filas.filter((f) => f.activo === 0 && f.visitado && !vivos.has(f.cliente_id)),
  };
}

/** El aviso de la lista vacia (D3), con la hora de la ultima sincronizacion. */
export function textoAvisoSinRuta(ultimaSincronizacion: string | null): string {
  return `La oficina no ha asignado ruta para hoy. Última sincronización: ${formatearMomento(ultimaSincronizacion)}.`;
}

/** La primera linea con texto del domicilio, o "sin domicilio" (un prospecto convertido sin el). */
export function primeraLineaDomicilio(domicilio: string | null): string {
  const linea = (domicilio ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return linea ?? 'sin domicilio';
}

const MAPS = 'https://www.google.com/maps/search/?api=1&query=';

/**
 * La direccion del cliente para Maps. Con coordenada (las dos), la coordenada;
 * si no, el domicilio codificado. Android abre la app de Maps si esta.
 */
export function urlMapa(cliente: Pick<Cliente, 'lat' | 'lng' | 'domicilio'>): string | null {
  if (cliente.lat !== null && cliente.lng !== null) {
    return `${MAPS}${cliente.lat},${cliente.lng}`;
  }
  const domicilio = cliente.domicilio?.trim();
  return domicilio ? `${MAPS}${encodeURIComponent(domicilio)}` : null;
}

/** `tel:` con solo digitos y `+`: el marcador no entiende parentesis ni guiones. */
export function urlTelefono(telefono: string | null): string | null {
  const limpio = (telefono ?? '').replace(/[^\d+]/g, '');
  return limpio.length > 0 ? `tel:${limpio}` : null;
}

/** El aviso breve al volver de "Agregar a mi ruta". */
export function textoAgregado(nombre: string): string {
  return `${nombre} agregado al final`;
}

/** Lo que lee el lector de pantalla en la burbuja. */
export function textoBurbuja(notas: number): string {
  return notas === 1 ? '1 nota pendiente' : `${notas} notas pendientes`;
}

/** Saca el elemento `desde` y lo mete en `hasta`. Fuera de rango, una copia igual. */
export function moverElemento<T>(lista: readonly T[], desde: number, hasta: number): T[] {
  const copia = [...lista];
  if (desde < 0 || desde >= copia.length || hasta < 0 || hasta >= copia.length) return copia;
  const [movido] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movido as T);
  return copia;
}

/**
 * A que posicion cae una fila arrastrada `dy` puntos, con filas de alto fijo
 * (D10). Redondea al renglon mas cercano y nunca se sale de la lista.
 */
export function indiceDestino(desde: number, dy: number, altoFila: number, total: number): number {
  if (total <= 0 || altoFila <= 0) return desde;
  const destino = desde + Math.round(dy / altoFila);
  return Math.min(total - 1, Math.max(0, destino));
}

/** Sin acentos y en minusculas: "Doña" se encuentra escribiendo "dona". */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Los clientes que se pueden agregar a la ruta de hoy: activos, `tipo =
 * 'cliente'` (D7) y que no estan ya vivos en la ruta, filtrados por nombre.
 */
export function filtrarParaAgregar<T extends Pick<Cliente, 'id' | 'nombre' | 'tipo' | 'activo'>>(
  clientes: readonly T[],
  enRuta: ReadonlySet<string>,
  busqueda: string,
  limite = 50,
): T[] {
  const q = normalizar(busqueda);
  return clientes
    .filter((c) => c.tipo === 'cliente' && c.activo === 1 && !enRuta.has(c.id))
    .filter((c) => q === '' || normalizar(c.nombre).includes(q))
    .slice(0, limite);
}

/** Las secciones del menu que todavia no existen, con el ticket que las trae. */
export const SECCIONES_PENDIENTES = {
  gastos: {
    titulo: 'Gastos',
    ticket: 'pieza 6 del rediseño (T-30/T-31)',
    descripcion:
      'Gastos de la ruta con su tipo (catálogo del portal), monto y comprobante.',
  },
  inventario: {
    titulo: 'Inventario',
    ticket: 'T-27',
    descripcion: 'Recarga y devolución de producto a media jornada.',
  },
  merma: {
    titulo: 'Merma, promoción y consumo',
    ticket: 'T-27 / T-31',
    descripcion:
      'Registros que afectan el inventario y el corte. La promoción entrega producto a $0 y el consumo propio se registra antes de enviar el sobrante.',
  },
} as const;

export type SeccionPendiente = keyof typeof SECCIONES_PENDIENTES;

export function esSeccionPendiente(seccion: string): seccion is SeccionPendiente {
  return Object.prototype.hasOwnProperty.call(SECCIONES_PENDIENTES, seccion);
}

/** Una entrada del menu hamburguesa (D9). `destino` es una ruta de expo-router. */
export interface EntradaMenu {
  clave: string;
  titulo: string;
  descripcion: string;
  destino: string;
  deshabilitada: boolean;
}

/**
 * Las entradas del menu, en el orden del spec (D16). Con el dia cerrado se
 * deshabilita solo lo que captura (gastos, inventario, merma); lo que consulta
 * se sigue viendo. Ruta y GPS es la pantalla pendiente de T-41 que ya existe.
 */
export function entradasMenu(diaCerrado: boolean): EntradaMenu[] {
  return [
    {
      clave: 'clientes',
      titulo: 'Todos los clientes',
      descripcion: 'El catálogo completo de la sucursal',
      destino: '/(jornada)/operacion',
      deshabilitada: false,
    },
    {
      clave: 'prospectos',
      titulo: 'Prospectos capturados',
      descripcion: 'Los prospectos de hoy y su sincronización',
      destino: '/(jornada)/prospectos',
      deshabilitada: false,
    },
    ...(['gastos', 'inventario', 'merma'] as const).map((clave) => ({
      clave,
      titulo: SECCIONES_PENDIENTES[clave].titulo,
      descripcion: `Pendiente: ${SECCIONES_PENDIENTES[clave].ticket}`,
      destino: `/(jornada)/pendiente/${clave}`,
      deshabilitada: diaCerrado,
    })),
    {
      clave: 'ruta-gps',
      titulo: 'Ruta y GPS',
      descripcion: 'Pendiente: T-41',
      destino: '/(jornada)/ruta',
      deshabilitada: false,
    },
    {
      clave: 'cerrar-dia',
      titulo: 'Cerrar el día',
      descripcion: 'Kilometraje final',
      destino: '/(jornada)/cerrar-dia',
      deshabilitada: false,
    },
  ];
}

/** Subconjunto de `Estado` de `@/ui/pantalla` (un .tsx con React Native no corre en Jest/Node). */
export type EstadoPastilla = 'pendiente' | 'listo' | 'error';

export type EstadoSubida = 'error' | 'pendiente' | 'listo';

/** Lo mas grave manda (misma regla que "Ventas de hoy" en la ficha). `null` si no hay nada. */
export function estadoSubida(estados: readonly SyncEstado[]): EstadoSubida | null {
  if (estados.length === 0) return null;
  if (estados.includes('error')) return 'error';
  if (estados.some((e) => e === 'pendiente' || e === 'enviando')) return 'pendiente';
  return 'listo';
}

export interface AtendidoFueraDeRuta {
  cliente_id: string;
  nombre: string;
  esProspecto: boolean;
  estado: EstadoSubida;
}

/**
 * Clientes y prospectos con venta del dia en esta tablet que la ruta NO pinta
 * (T-75, D7): ni vivos ni quitados-con-visita (esos ya salen en "Fuera de
 * ruta"). Un quitado sin visita con venta local si sale: la venta es real y la
 * ruta ya no lo muestra. Por nombre; uno por cliente, con el estado mas grave.
 */
export function atendidosFueraDeRuta(
  filasRuta: readonly FilaAgrupable[],
  ventas: readonly Pick<Venta, 'cliente_id' | 'sync_estado'>[],
  cliente: (id: string) => Pick<Cliente, 'nombre' | 'tipo'> | null,
): AtendidoFueraDeRuta[] {
  const pintados = new Set(
    filasRuta.filter((f) => f.activo === 1 || f.visitado).map((f) => f.cliente_id),
  );
  const porCliente = new Map<string, SyncEstado[]>();
  for (const v of ventas) {
    if (pintados.has(v.cliente_id)) continue;
    porCliente.set(v.cliente_id, [...(porCliente.get(v.cliente_id) ?? []), v.sync_estado]);
  }
  const filas: AtendidoFueraDeRuta[] = [];
  for (const [cliente_id, estados] of porCliente) {
    const c = cliente(cliente_id);
    if (!c) continue;
    const estado = estadoSubida(estados);
    if (!estado) continue;
    filas.push({ cliente_id, nombre: c.nombre, esProspecto: c.tipo === 'prospecto', estado });
  }
  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

const PREFIJO_CODIGO = /^([a-z][a-z0-9-]*): /;

/**
 * El detalle de un alta rechazada (T-75, D4). `sync_error` guarda `codigo: motivo`;
 * se muestra el motivo sin el prefijo técnico. Solo `tipo-negocio-inexistente` se
 * recupera solo (cuando la oficina reactive el giro); en cualquier otro caso hay que
 * avisar a la oficina. En los dos, el vendedor no debe volver a capturar al prospecto.
 */
function detalleDeAltaRechazada(syncError: string | null): string {
  const m = syncError ? PREFIJO_CODIGO.exec(syncError) : null;
  const codigo = m ? m[1] : null;
  const motivo = (m ? syncError!.slice(m[0].length) : syncError)?.trim() || 'El servidor rechazó el alta.';
  return codigo === 'tipo-negocio-inexistente'
    ? `${motivo} Su venta subirá cuando la oficina reactive el tipo de negocio. No lo vuelvas a capturar.`
    : `${motivo} Avisa a la oficina; no lo vuelvas a capturar.`;
}

/** La pastilla del alta del prospecto en su ficha (T-75, D4). `null` si no es de esta tablet. */
export function pastillaAlta(
  p: Pick<Prospecto, 'sync_estado' | 'sync_error'> | null,
): { texto: string; estado: EstadoPastilla; detalle: string | null } | null {
  if (!p) return null;
  switch (p.sync_estado) {
    case 'pendiente':
      return { texto: 'alta por subir', estado: 'pendiente', detalle: null };
    case 'enviando':
      return { texto: 'alta subiendo', estado: 'pendiente', detalle: null };
    case 'sincronizado':
      return { texto: 'alta subida', estado: 'listo', detalle: null };
    case 'error':
      return {
        texto: 'alta rechazada',
        estado: 'error',
        detalle: detalleDeAltaRechazada(p.sync_error),
      };
  }
}

/** Id de la ficha a la que enlaza una fila de "Prospectos de hoy", o `null` (T-75, D6). */
export function enlaceAFicha(prospectoId: string, existeCliente: (id: string) => boolean): string | null {
  return existeCliente(prospectoId) ? prospectoId : null;
}
