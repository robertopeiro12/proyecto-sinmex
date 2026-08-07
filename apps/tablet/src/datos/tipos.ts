/**
 * Tipos de la capa de datos local.
 *
 * Son el reflejo 1:1 de las filas de SQLite, sin adornos: los booleanos viajan
 * como `0 | 1` y las fechas como texto ISO, tal cual estan guardados. La
 * traduccion a tipos "bonitos" es responsabilidad de quien los presente.
 */

/** SQLite no tiene booleano. */
export type Booleano = 0 | 1;

/** Fecha `AAAA-MM-DD` en la zona horaria de la tablet (Tijuana). */
export type FechaISO = string;

/** Timestamp ISO-8601 completo. */
export type MomentoISO = string;

/** Estado de sincronizacion de una entidad capturada offline. Ver T-07. */
export type SyncEstado = 'pendiente' | 'enviando' | 'sincronizado' | 'error';

export interface Sucursal {
  id: string;
  codigo: string;
  nombre: string;
  activa: Booleano;
  sincronizado_en: MomentoISO;
}

export interface Vendedor {
  id: string;
  login: string;
  nombre: string;
  sucursal_id: string;
  activo: Booleano;
  sincronizado_en: MomentoISO;
}

export interface Vehiculo {
  id: string;
  nombre: string;
  sucursal_id: string;
  activo: Booleano;
  sincronizado_en: MomentoISO;
}

export interface Producto {
  id: string;
  nombre: string;
  activo: Booleano;
  sincronizado_en: MomentoISO;
}

export interface Presentacion {
  id: string;
  producto_id: string;
  volumen: string;
  sincronizado_en: MomentoISO;
}

export type TipoCliente = 'cliente' | 'prospecto';
export type Promocion = 'ninguna' | '10+1' | '20+1';

export interface Cliente {
  id: string;
  nombre: string;
  domicilio: string;
  telefono: string;
  encargado: string | null;
  tipo: TipoCliente;
  pct_comision: number | null;
  promocion: Promocion;
  plazo_credito_dias: number | null;
  lat: number | null;
  lng: number | null;
  sucursal_id: string;
  sincronizado_en: MomentoISO;
}

export interface ClientePrecio {
  id: string;
  cliente_id: string;
  presentacion_id: string;
  /** En centavos: ver la nota sobre dinero en `001-esquema-inicial.ts`. */
  precio_centavos: number;
  vigente_desde: FechaISO;
  sincronizado_en: MomentoISO;
}

export type EstadoJornada = 'abierta' | 'cerrada';

export interface Jornada {
  id: string;
  fecha: FechaISO;
  vendedor_id: string;
  vehiculo_id: string;
  km_inicial: number;
  km_final: number | null;
  abierta_en: MomentoISO;
  cerrada_en: MomentoISO | null;
  estado: EstadoJornada;
  sync_estado: SyncEstado;
  actualizado_local_en: MomentoISO;
  sincronizado_en: MomentoISO | null;
}
