import type { FilaRutaDelDia } from '@/datos/repositorios/rutas';
import type { Cliente, Prospecto, SyncEstado, Venta, Visita } from '@/datos/tipos';
import type { NombreIcono } from '@/ui/iconos';
import { formatearMomento } from '@/ui/momento';
import { pesos } from '@/ui/pesos';

/**
 * Lo que la pantalla principal decide (T-37, D16), sin React: la tablet no tiene
 * pruebas de pantalla, asi que todo lo que se pueda fijar con una prueba vive
 * aqui (mismo criterio que `menu-jornada.ts`, T-38).
 */

/** Lo minimo que `agruparRutaEnCurso` necesita de una fila. */
export type FilaAgrupable = Pick<FilaRutaDelDia, 'cliente_id' | 'activo' | 'visitado'>;

/**
 * Reparte las filas del dia (ya en el orden del portal, `rutas.delDia`) entre
 * "Por visitar", "Visitados" y "Fuera de ruta" (rediseño §6; D16):
 *
 * - Viva sin nada hecho hoy → "Por visitar".
 * - Viva con algo hecho hoy (venta, cobro, visita, comentario de no cobro o
 *   merma), con o sin venta → "Visitados". Se puede volver a abrir.
 * - Quitada por la oficina **con** actividad hoy → "Fuera de ruta".
 * - Quitada **sin** actividad → desaparece.
 * - Si el cliente quitado volvio a la ruta (otra fila viva), no se pinta dos veces.
 */
export function agruparRutaEnCurso<T extends FilaAgrupable>(
  filas: readonly T[],
): { porVisitar: T[]; visitados: T[]; fueraDeRuta: T[] } {
  const vivos = new Set(filas.filter((f) => f.activo === 1).map((f) => f.cliente_id));
  return {
    porVisitar: filas.filter((f) => f.activo === 1 && !f.visitado),
    visitados: filas.filter((f) => f.activo === 1 && f.visitado),
    fueraDeRuta: filas.filter((f) => f.activo === 0 && f.visitado && !vivos.has(f.cliente_id)),
  };
}

/**
 * ¿La oficina no asigno ruta hoy? Solo si las TRES secciones estan vacias: con
 * todos los clientes visitados "Por visitar" queda vacia, pero si hay ruta.
 */
export function sinRutaAsignada(grupos: {
  porVisitar: readonly unknown[];
  visitados: readonly unknown[];
  fueraDeRuta: readonly unknown[];
}): boolean {
  return grupos.porVisitar.length === 0 && grupos.visitados.length === 0 && grupos.fueraDeRuta.length === 0;
}

/**
 * La linea bajo el nombre en "Visitados" (rediseño §6, maqueta 6): lo que se
 * hizo hoy con el cliente, en este orden y unido con " · ": "Cobro $850.00",
 * "Venta $1,240.00" (contado), "Venta a crédito $1,240.00", "Merma". Sin
 * ninguna de esas y con visita: "Visita sin venta · <motivo en minusculas>"
 * ("Visita sin venta" a secas sin motivo, p. ej. solo el comentario de no
 * cobro). Dinero con centavos, como en toda la app (`pesos`).
 */
export function resumenVisitado(
  f: Pick<
    FilaRutaDelDia,
    | 'venta_contado_centavos'
    | 'venta_credito_centavos'
    | 'cobro_centavos'
    | 'con_merma'
    | 'ultima_visita_motivo'
    | 'visita_sin_venta'
  >,
): string {
  const partes: string[] = [];
  if (f.cobro_centavos > 0) partes.push(`Cobro ${pesos(f.cobro_centavos)}`);
  if (f.venta_contado_centavos > 0) partes.push(`Venta ${pesos(f.venta_contado_centavos)}`);
  if (f.venta_credito_centavos > 0) partes.push(`Venta a crédito ${pesos(f.venta_credito_centavos)}`);
  if (f.con_merma) partes.push('Merma');
  if (partes.length === 0 && f.visita_sin_venta) {
    const motivo = f.ultima_visita_motivo?.trim();
    return motivo ? `Visita sin venta · ${motivo.toLowerCase()}` : 'Visita sin venta';
  }
  return partes.join(' · ');
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

/** Lo que lee el lector de pantalla en el contador de notas de la fila. */
export function textoNotasQueTrae(notas: number): string {
  return notas === 1 ? 'Trae 1 nota por cobrar' : `Trae ${notas} notas por cobrar`;
}

/** Sin acentos y en minusculas: "Doña" se encuentra escribiendo "dona". */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * "Agregar a mi ruta" (rediseno pieza 1, maqueta 20): todos los clientes activos
 * de la sucursal (`tipo = 'cliente'`, D7) en orden alfabetico, filtrados por
 * nombre sin acentos, cada uno con `enRuta` (ya vivo en la ruta de hoy). Sin tope
 * por omision (la pantalla virtualiza); `limite` solo si alguien lo pide.
 */
export function clientesParaAgregar<T extends Pick<Cliente, 'id' | 'nombre' | 'tipo' | 'activo'>>(
  clientes: readonly T[],
  enRuta: ReadonlySet<string>,
  busqueda: string,
  limite?: number,
): (T & { enRuta: boolean })[] {
  const q = normalizar(busqueda);
  return clientes
    .filter((c) => c.tipo === 'cliente' && c.activo === 1)
    .filter((c) => q === '' || normalizar(c.nombre).includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
    .slice(0, limite)
    .map((c) => ({ ...c, enRuta: enRuta.has(c.id) }));
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

export type ClaveMenu =
  | 'ruta'
  | 'inventario'
  | 'sugerido'
  | 'registros'
  | 'merma'
  | 'gastos'
  | 'corte'
  | 'prospectos'
  | 'impresora'
  | 'salir';

/** Una entrada del menu lateral. `destino` es una ruta de expo-router; `null` solo en `salir`. */
export interface EntradaMenu {
  clave: ClaveMenu;
  titulo: string;
  icono: NombreIcono;
  destino: string | null;
  deshabilitada: boolean;
  /** Frase corta bajo el titulo (hoy: lo que falta para abrir Corte). */
  nota: string | null;
}

/**
 * Las entradas del menu, en el orden del spec §5 (maqueta 3). Con el dia
 * cerrado se deshabilita solo lo que captura (gastos, merma); lo que consulta
 * se sigue viendo, y Corte se abre (ya se hizo). Corte lleva candado mientras
 * falten clientes por visitar.
 */
export function entradasMenu({
  porVisitar,
  diaCerrado,
}: {
  porVisitar: number;
  diaCerrado: boolean;
}): EntradaMenu[] {
  const corteConCandado = !diaCerrado && porVisitar > 0;
  const entrada = (
    clave: ClaveMenu,
    titulo: string,
    icono: NombreIcono,
    destino: string | null,
    extra: Partial<Pick<EntradaMenu, 'deshabilitada' | 'nota'>> = {},
  ): EntradaMenu => ({ clave, titulo, icono, destino, deshabilitada: false, nota: null, ...extra });
  return [
    entrada('ruta', 'Ruta', 'ubicacion', '/(jornada)'),
    entrada('inventario', 'Inventario', 'inventario', '/(jornada)/inventario'),
    entrada('sugerido', 'Sugerido de carga', 'sugerido', '/(jornada)/sugerido-de-carga'),
    entrada('registros', 'Ventas / Cobranza', 'registros', '/(jornada)/registros'),
    entrada('merma', 'Merma / Cambios', 'merma', '/(jornada)/merma', { deshabilitada: diaCerrado }),
    entrada('gastos', 'Gastos', 'gasto', '/(jornada)/gastos', { deshabilitada: diaCerrado }),
    entrada('corte', 'Corte', 'corte', '/(jornada)/cerrar-dia', {
      deshabilitada: corteConCandado,
      nota: corteConCandado ? (porVisitar === 1 ? 'falta 1 cliente' : `faltan ${porVisitar} clientes`) : null,
    }),
    entrada('prospectos', 'Prospectos', 'prospecto', '/(jornada)/prospectos'),
    entrada('impresora', 'Seleccionar impresora', 'impresora', '/(jornada)/impresora'),
    entrada('salir', 'Cerrar sesión', 'salir', null),
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
 * salen en "Visitados" o "Fuera de ruta"). Uno por cliente, con el
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
