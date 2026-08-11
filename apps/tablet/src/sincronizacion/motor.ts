/**
 * Motor de sincronizacion de la tablet (T-07).
 *
 * Tres pasos, **en este orden**:
 *
 * 1. **Renovar la sesion.** No es un detalle de implementacion, es un requisito
 *    escrito: desde T-06 la tablet solo opera 72 h sin hablar con el servidor,
 *    y ese contador se reinicia con cada contacto exitoso. Si la
 *    sincronizacion bajara el dia sin renovar, el vendedor podria descargarlo
 *    todo correctamente y aun asi quedarse fuera de su app al dia siguiente,
 *    sin ninguna pista de por que. Ese mismo refresh es ademas **el unico
 *    camino** por el que una baja hecha en el portal llega a la tablet.
 *    Ver ADR-0005 y [[Sincronizacion offline]].
 * 2. **Pull.** Catalogos, precios ya resueltos y notas pendientes. Incremental
 *    si ya hay cursor guardado.
 * 3. **Push.** La operacion capturada offline, por lotes idempotentes.
 *
 * El pull va **antes** del push a proposito: si la conexion se corta a la
 * mitad, es preferible haber refrescado los catalogos (el vendedor puede seguir
 * trabajando) que haber subido el dia y quedarse con datos viejos. Y lo subido
 * no se pierde: sigue en la cola, y reenviarlo no duplica nada.
 *
 * Todo esto es probable en Node: recibe la API, la capa de datos, la sesion y
 * el reloj por inyeccion. Ver `motor.spec.ts`.
 */
import type { RepositorioCatalogos, SnapshotCatalogos } from '@/datos/repositorios/catalogos';
import type { RepositorioSync } from '@/datos/repositorios/sync';
import { SinRedError } from '@/sesion/api';

import {
  ContratoIncompatibleError,
  FueraDeAlcanceError,
  SesionRechazadaError,
  type ClienteSync,
} from './api';
import {
  MAX_OPERACIONES_POR_LOTE,
  type OperacionSaliente,
  type RespuestaPull,
  type ResultadoOperacion,
  type TipoOperacion,
} from './contrato';

/**
 * De donde salen las operaciones que se suben.
 *
 * Cada modulo de negocio registrara la suya (venta, cobranza, gasto, merma,
 * ruta) sin tocar el motor. Hoy solo existe la jornada, que es la unica entidad
 * operativa que T-04 dejo implementada.
 *
 * TODO: T-16/T-20/T-27/T-33/T-39 — una fuente por modulo.
 */
export interface FuenteOperaciones {
  tipo: TipoOperacion;
  /** Lo que falta por subir, ya en forma de operacion del contrato. */
  pendientes(): OperacionSaliente[];
  /** El servidor la acepto (o ya la tenia). */
  marcarSincronizada(clave: string): void;
  /** El servidor la rechazo, con su motivo. */
  marcarError(clave: string, motivo: string): void;
}

export interface DepsMotor {
  api: ClienteSync;
  catalogos: RepositorioCatalogos;
  sync: RepositorioSync;
  fuentes: FuenteOperaciones[];
  /**
   * La sesion, reducida a lo que el motor necesita.
   *
   * `renovar()` es la de `sesion/gestor.ts`: rota la sesion contra
   * `/auth/app/refresh` y corre hacia adelante la ventana offline.
   */
  sesion: {
    renovar(): Promise<boolean>;
    tokenAcceso(): string | null;
  };
}

export type MotivoAbandono =
  /** No hay sesion guardada, o el servidor la rechazo. */
  | 'sin-sesion'
  /** No se pudo alcanzar el servidor. Se reintenta luego, sin perder nada. */
  | 'sin-red'
  /** Tablet y servidor hablan versiones distintas del contrato. */
  | 'contrato'
  /** El servidor rechazo el alcance. Es un bug, no una condicion de campo. */
  | 'alcance';

export interface ResumenPull {
  completo: boolean;
  cursor: string;
  filas: number;
  notas: number;
}

export interface ResumenPush {
  enviadas: number;
  aplicadas: number;
  duplicadas: number;
  rechazadas: number;
}

export interface ResultadoSincronizacion {
  ok: boolean;
  /** Presente solo si algo impidio completar. */
  motivo?: MotivoAbandono;
  detalle?: string;
  /** Si se renovo la sesion (y por tanto corrio la ventana offline). */
  sesionRenovada: boolean;
  pull?: ResumenPull;
  push?: ResumenPush;
}

export type MotorSincronizacion = ReturnType<typeof crearMotorSincronizacion>;

export function crearMotorSincronizacion({
  api,
  catalogos,
  sync,
  fuentes,
  sesion,
}: DepsMotor) {
  return {
    /**
     * Una pasada completa de sincronizacion.
     *
     * Nunca lanza por una condicion de campo (sin red, sesion caida): devuelve
     * el motivo. Quien la llama esta normalmente en un flujo que **no debe
     * romperse** por no haber podido sincronizar — el login, o un boton de
     * "sincronizar ahora" en medio de la jornada.
     */
    async sincronizar(): Promise<ResultadoSincronizacion> {
      // --- 1. Renovar la sesion. Primero, siempre.
      const renovada = await sesion.renovar();
      const token = sesion.tokenAcceso();

      if (token === null) {
        // O nunca hubo sesion, o el servidor la tumbo y el gestor borro el
        // material local. En ambos casos no hay nada que sincronizar.
        return { ok: false, motivo: 'sin-sesion', sesionRenovada: false };
      }
      if (!renovada) {
        // Hay sesion guardada pero no se alcanzo al servidor. No tiene sentido
        // intentar el pull: fallaria igual y ademas dejaria la ventana offline
        // sin correr, que es lo que de verdad importaba de este paso.
        return { ok: false, motivo: 'sin-red', sesionRenovada: false };
      }

      const resultado: ResultadoSincronizacion = { ok: true, sesionRenovada: true };

      // --- 2. Pull
      try {
        resultado.pull = await bajar(token);
      } catch (error) {
        return { ...resultado, ok: false, ...traducir(error) };
      }

      // --- 3. Push
      try {
        resultado.push = await subir(token);
      } catch (error) {
        return { ...resultado, ok: false, ...traducir(error) };
      }

      return resultado;
    },
  };

  async function bajar(token: string): Promise<ResumenPull> {
    const desde = sync.leerCursor();
    const respuesta = await api.pull(token, desde);

    const snapshot = aSnapshot(respuesta);
    catalogos.guardarSnapshot(snapshot);

    // El cursor se guarda DESPUES de aplicar el snapshot. Al reves, un fallo al
    // escribir dejaria a la tablet creyendo estar al dia sin estarlo, y esos
    // cambios no volverian a bajar nunca.
    sync.guardarCursor(respuesta.cursor);

    return {
      completo: respuesta.completo,
      cursor: respuesta.cursor,
      filas: contarFilas(snapshot),
      notas: respuesta.notas_pendientes.length,
    };
  }

  async function subir(token: string): Promise<ResumenPush> {
    const total: ResumenPush = {
      enviadas: 0,
      aplicadas: 0,
      duplicadas: 0,
      rechazadas: 0,
    };

    for (const fuente of fuentes) {
      const operaciones = fuente.pendientes();

      // Se trocea en lotes: el servidor rechaza con 400 un lote de mas de
      // MAX_OPERACIONES_POR_LOTE, y la tablet traduce un 400 a "sin red", asi
      // que un dia con muchas operaciones se reintentaria para siempre en
      // silencio. Hoy solo hay jornadas (una al dia) y no se llega ni de lejos,
      // pero el dia que T-16 registre ventas por cliente si.
      //
      // Cada lote es independiente: si el tercero falla por red, los dos
      // primeros ya quedaron aplicados y no se vuelven a mandar.
      for (let i = 0; i < operaciones.length; i += MAX_OPERACIONES_POR_LOTE) {
        const lote = operaciones.slice(i, i + MAX_OPERACIONES_POR_LOTE);
        const respuesta = await api.push(token, lote);

        total.enviadas += lote.length;
        total.aplicadas += respuesta.resumen.aplicadas;
        total.duplicadas += respuesta.resumen.duplicadas;
        total.rechazadas += respuesta.resumen.rechazadas;

        for (const r of respuesta.resultados) {
          aplicarResultado(fuente, r);
        }
      }
    }

    return total;
  }
}

/**
 * `duplicada` se trata como exito, y es el punto entero de la idempotencia: la
 * operacion ya estaba en el servidor, asi que marcarla como error obligaria a
 * reintentarla para siempre.
 */
function aplicarResultado(fuente: FuenteOperaciones, r: ResultadoOperacion): void {
  if (r.estado === 'rechazada') {
    fuente.marcarError(r.clave, `${r.codigo ?? 'rechazada'}: ${r.motivo ?? ''}`.trim());
    return;
  }
  fuente.marcarSincronizada(r.clave);
}

/**
 * Traduce la excepcion del cliente HTTP al motivo que entiende la app.
 *
 * Un error que no sea de red, sesion, contrato o alcance **se deja propagar**:
 * es un bug, y tragarselo lo convertiria en "no sincronizo, no se sabe por
 * que", que es la clase de fallo que nadie encuentra.
 */
function traducir(error: unknown): { motivo: MotivoAbandono; detalle?: string } {
  if (error instanceof SesionRechazadaError) {
    return { motivo: 'sin-sesion', detalle: error.message };
  }
  if (error instanceof ContratoIncompatibleError) {
    return { motivo: 'contrato', detalle: error.detalle };
  }
  if (error instanceof FueraDeAlcanceError) {
    return { motivo: 'alcance', detalle: error.message };
  }
  if (error instanceof SinRedError) {
    return { motivo: 'sin-red', detalle: error.message };
  }
  throw error;
}

/**
 * Respuesta del servidor → snapshot de la capa de datos.
 *
 * Casi todo coincide campo a campo (los nombres del esquema local se alinearon
 * con los de Postgres en T-04 justo para esto). La excepcion es `sucursal`, que
 * en la tabla local se llama `activa` y no `activo`.
 */
export function aSnapshot(respuesta: RespuestaPull): SnapshotCatalogos {
  const c = respuesta.catalogos;
  return {
    sucursales: c.sucursales.map(({ id, codigo, nombre, activo }) => ({
      id,
      codigo,
      nombre,
      activa: activo,
    })),
    vendedores: c.vendedores,
    vehiculos: c.vehiculos,
    productos: c.productos,
    presentaciones: c.presentaciones,
    clientes: c.clientes,
    precios: c.precios,
    notas: respuesta.notas_pendientes,
  };
}

function contarFilas(snapshot: SnapshotCatalogos): number {
  return Object.values(snapshot).reduce(
    (total, filas) => total + (filas?.length ?? 0),
    0,
  );
}
