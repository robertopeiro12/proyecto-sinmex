import type { FilaRutaDelDia } from '@/datos/repositorios/rutas';
import type { Cliente, Prospecto, SyncEstado, Venta, Visita } from '@/datos/tipos';
import { formatearHora, formatearMomento } from '@/ui/momento';

/**
 * Lo que la pantalla principal decide (T-37, D16), sin React: la tablet no tiene
 * pruebas de pantalla, asi que todo lo que se pueda fijar con una prueba vive
 * aqui (mismo criterio que `menu-jornada.ts`, T-38).
 */

/** Lo minimo que `agruparRuta` necesita de una fila. */
export type FilaAgrupable = Pick<FilaRutaDelDia, 'cliente_id' | 'activo' | 'visitado' | 'visita_sin_venta'>;

/**
 * Reparte las filas del dia (ya ordenadas por `rutas.delDia`) entre la ruta,
 * "Visitados sin venta" y "Fuera de ruta" (D5, D16; T-39 D8):
 *
 * - Viva sin visita-sin-venta → en la ruta, visitada o no (la palomita no la saca).
 * - Viva con visita y SIN venta ni cobro → "Visitados sin venta". Si despues
 *   compra, `visita_sin_venta` pasa a `false` y regresa a la ruta con su palomita.
 * - Quitada por la oficina **con** actividad hoy (venta, cobro o visita) → "Fuera de ruta".
 * - Quitada **sin** actividad → desaparece.
 * - Si el cliente quitado volvio a la ruta (otra fila viva), no se pinta dos veces.
 */
export function agruparRuta<T extends FilaAgrupable>(
  filas: readonly T[],
): { enRuta: T[]; visitadosSinVenta: T[]; fueraDeRuta: T[] } {
  const vivos = new Set(filas.filter((f) => f.activo === 1).map((f) => f.cliente_id));
  return {
    enRuta: filas.filter((f) => f.activo === 1 && !f.visita_sin_venta),
    visitadosSinVenta: filas.filter((f) => f.activo === 1 && f.visita_sin_venta),
    fueraDeRuta: filas.filter((f) => f.activo === 0 && f.visitado && !vivos.has(f.cliente_id)),
  };
}

/**
 * ¿La oficina no asigno ruta hoy? Solo si las TRES secciones estan vacias: con
 * todos los clientes visitados sin venta la lista queda vacia, pero si hay ruta.
 */
export function sinRutaAsignada(grupos: {
  enRuta: readonly unknown[];
  visitadosSinVenta: readonly unknown[];
  fueraDeRuta: readonly unknown[];
}): boolean {
  return grupos.enRuta.length === 0 && grupos.visitadosSinVenta.length === 0 && grupos.fueraDeRuta.length === 0;
}

/** La linea de la fila de "Visitados sin venta": "Cerrado · 10:42". */
export function textoUltimaVisita(motivo: string | null, en: string | null): string {
  return `${motivo ?? 'Visita'} · ${formatearHora(en)}`;
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

/**
 * Ancho del menu lateral (rediseno del menu, 2026-10-18): el 82% de la pantalla
 * con tope de 320dp. En el celular deja ver una franja de la ruta oscurecida
 * (la que cierra el menu al tocarla); en la tablet no se come media pantalla.
 */
export const ANCHO_MAXIMO_MENU = 320;
export function anchoMenuLateral(anchoPantalla: number): number {
  return Math.round(Math.min(ANCHO_MAXIMO_MENU, Math.max(0, anchoPantalla) * 0.82));
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
 * deshabilita solo lo que captura (gastos, merma y consumo); lo que consulta se
 * sigue viendo. T-30/T-31 dio a Gastos su pantalla, T-27 a Inventario y la
 * pieza 2 a Merma y consumo. Ruta y GPS es la pantalla pendiente de T-41 que ya
 * existe.
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
    {
      clave: 'gastos',
      titulo: 'Gastos',
      descripcion: 'Lo que pagaste hoy con la cobranza',
      destino: '/(jornada)/gastos',
      deshabilitada: diaCerrado,
    },
    {
      clave: 'inventario',
      titulo: 'Inventario',
      descripcion: 'Tu carga, tus recargas y lo que te queda',
      destino: '/(jornada)/inventario',
      // T-27: es consulta (y aceptar la carga de la manana); se ve con el dia cerrado.
      deshabilitada: false,
    },
    {
      clave: 'merma',
      titulo: 'Merma y consumo',
      descripcion: 'Merma del trayecto y consumo propio',
      destino: '/(jornada)/merma',
      // Captura (como Gastos): con el dia cerrado no se registra.
      deshabilitada: diaCerrado,
    },
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
  /** T-39: solo se le visito (sin venta): la fila lleva la etiqueta "visita". */
  soloVisita: boolean;
}

/**
 * Clientes y prospectos con venta **o visita** del dia en esta tablet que la
 * ruta NO pinta (T-75, D7; T-39 D8): ni vivos ni quitados-con-actividad (esos ya
 * salen en "Fuera de ruta" o "Visitados sin venta"). Uno por cliente, con el
 * estado mas grave de sus ventas y visitas; `soloVisita` si no tiene venta.
 */
export function atendidosFueraDeRuta(
  filasRuta: readonly FilaAgrupable[],
  ventas: readonly Pick<Venta, 'cliente_id' | 'sync_estado'>[],
  visitas: readonly Pick<Visita, 'cliente_id' | 'sync_estado'>[],
  cliente: (id: string) => Pick<Cliente, 'nombre' | 'tipo'> | null,
): AtendidoFueraDeRuta[] {
  const pintados = new Set(
    filasRuta.filter((f) => f.activo === 1 || f.visitado).map((f) => f.cliente_id),
  );
  const porCliente = new Map<string, { estados: SyncEstado[]; ventas: number }>();
  const anotar = (clienteId: string, estado: SyncEstado, esVenta: boolean) => {
    if (pintados.has(clienteId)) return;
    const actual = porCliente.get(clienteId) ?? { estados: [], ventas: 0 };
    porCliente.set(clienteId, {
      estados: [...actual.estados, estado],
      ventas: actual.ventas + (esVenta ? 1 : 0),
    });
  };
  for (const v of ventas) anotar(v.cliente_id, v.sync_estado, true);
  for (const w of visitas) anotar(w.cliente_id, w.sync_estado, false);

  const filas: AtendidoFueraDeRuta[] = [];
  for (const [cliente_id, { estados, ventas: cuantas }] of porCliente) {
    const c = cliente(cliente_id);
    if (!c) continue;
    const estado = estadoSubida(estados);
    if (!estado) continue;
    filas.push({
      cliente_id,
      nombre: c.nombre,
      esProspecto: c.tipo === 'prospecto',
      estado,
      soloVisita: cuantas === 0,
    });
  }
  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

const PREFIJO_CODIGO = /^([a-z][a-z0-9-]*): /;

/**
 * Parte un `sync_error` (`codigo: motivo`) en el codigo tecnico y el motivo legible.
 * Sin prefijo, `codigo` es `null`; sin texto, el motivo es el `respaldo`. Una sola regla
 * para el alta de T-75 y la visita de T-39.
 */
function sinPrefijoDeCodigo(
  syncError: string | null,
  respaldo: string,
): { codigo: string | null; motivo: string } {
  const m = syncError ? PREFIJO_CODIGO.exec(syncError) : null;
  const codigo = m ? m[1]! : null;
  const motivo = (m ? syncError!.slice(m[0].length) : syncError)?.trim() || respaldo;
  return { codigo, motivo };
}

/** El motivo de un rechazo sin el prefijo técnico `codigo: ` (T-39; lo usaba ya el alta de T-75). */
export function motivoDeRechazo(syncError: string | null): string {
  return sinPrefijoDeCodigo(syncError, 'El servidor la rechazó.').motivo;
}

/**
 * El detalle de un alta rechazada (T-75, D4). `sync_error` guarda `codigo: motivo`;
 * se muestra el motivo sin el prefijo técnico. Solo `tipo-negocio-inexistente` se
 * recupera solo (cuando la oficina reactive el giro); en cualquier otro caso hay que
 * avisar a la oficina. En los dos, el vendedor no debe volver a capturar al prospecto.
 */
function detalleDeAltaRechazada(syncError: string | null): string {
  const { codigo, motivo } = sinPrefijoDeCodigo(syncError, 'El servidor rechazó el alta.');
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
