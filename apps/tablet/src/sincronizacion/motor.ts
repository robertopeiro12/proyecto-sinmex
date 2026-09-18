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
 * 4. **Fotos de prospectos** (T-40). Un `POST` por foto, fuera del lote.
 *
 * El pull va **antes** del push a proposito: si la conexion se corta a la
 * mitad, es preferible haber refrescado los catalogos (el vendedor puede seguir
 * trabajando) que haber subido el dia y quedarse con datos viejos. Y lo subido
 * no se pierde: sigue en la cola, y reenviarlo no duplica nada.
 *
 * Las fotos van **al final, despues del push, y eso es obligatorio**: antes de
 * que el servidor acepte el alta no existe la fila `cliente` a la que la foto
 * pertenece, asi que subirla solo podria dar 404. Un prospecto capturado en esta
 * misma pasada ya es elegible en esta misma pasada, porque el push corrio antes.
 *
 * > [!danger] El paso 4 no puede tocar el estado de ningun prospecto
 * > Es el fallo que todo el diseno de la foto existe para prevenir: si la foto se
 * > llevara el alta, se perderia un cliente potencial **en silencio**. Por eso el
 * > paso 4 escribe solo en las columnas de foto, y por eso un fallo aqui **no
 * > pone `ok: false`** — el negocio del dia ya subio, y decirle al vendedor que
 * > la sincronizacion fallo por una foto opcional seria mentirle. Lo que si hace
 * > es reportarlo en `fotos`. Ver `subirFotos` y `api-foto.ts`.
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
  LoteDemasiadoGrandeError,
  SesionRechazadaError,
  type ClienteSync,
} from './api';
import {
  FotoPermanenteError,
  FotoTemporalError,
  type ClienteFotos,
} from './api-foto';
import type { FuenteFotos } from './fuente-fotos';
import {
  MAX_BYTES_POR_LOTE,
  MAX_OPERACIONES_POR_LOTE,
  type OperacionSaliente,
  type RespuestaPull,
  type ResultadoOperacion,
  type TipoOperacion,
} from './contrato';
import { trocearLotes } from './lotes';

/**
 * De donde salen las operaciones que se suben.
 *
 * Cada modulo de negocio registra la suya sin tocar el motor: hoy jornada
 * (T-04), venta (T-16), prospecto (T-40) y cobranza (T-20), en
 * `proveedor-sesion.tsx`. Faltan gasto, merma y ruta (T-27/T-33/T-39).
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
   * El canal de la foto (T-40): de donde salen y por donde suben.
   *
   * Es **obligatorio** y no opcional a proposito. Un motor al que se le pudiera
   * olvidar el canal de la foto sincronizaria de maravilla y dejaria las fotos
   * en el equipo para siempre, sin un solo error en ninguna parte: el tipo lo
   * impide en tiempo de compilacion. Quien no tenga fotos que subir pasa una
   * fuente vacia, que es una decision explicita y se lee como tal.
   */
  fotos: {
    fuente: FuenteFotos;
    api: ClienteFotos;
  };
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
  | 'alcance'
  /** Bug de troceo: el lote supero el limite del servidor. */
  | 'lote-grande';

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

/** Lo que paso con las fotos. Informativo: nunca cambia `ok`. */
export interface ResumenFotos {
  intentadas: number;
  subidas: number;
  /** Fallaron esta vez y siguen en la cola. */
  pendientes: number;
  /** No van a entrar nunca (413, 415, archivo perdido): se dejaron de intentar. */
  descartadas: number;
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
  /**
   * El paso 4. Presente si se llego a intentarlo, aunque ninguna foto subiera.
   *
   * Que esto traiga `descartadas: 2` con `ok: true` es correcto y deliberado: el
   * dia del vendedor esta arriba, y dos fotos no van a entrar. Un prospecto sin
   * foto es un prospecto completo.
   */
  fotos?: ResumenFotos;
}

export type MotorSincronizacion = ReturnType<typeof crearMotorSincronizacion>;

export function crearMotorSincronizacion({
  api,
  catalogos,
  sync,
  fuentes,
  fotos,
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

      // --- 4. Fotos de los prospectos que el push ya dejo sincronizados.
      //
      // Sin `try/catch` que convierta el fallo en un motivo, a diferencia de los
      // otros dos pasos: `subirFotos` ya clasifica dentro lo que puede pasar en
      // campo y no deja escapar nada de eso. Lo unico que llega aqui es un bug,
      // y se propaga igual que en el pull y el push — tragarselo lo convertiria
      // en "las fotos no suben y no se sabe por que".
      //
      // Llegados aqui el push ya esta confirmado en SQLite, asi que ni una
      // excepcion puede perder el dia del vendedor.
      resultado.fotos = await subirFotos(token);

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

      // Se trocea por cantidad Y por tamano, y manda el tope que se alcance
      // primero. Por cantidad solo no basta: un lote de 500 ventas cabe por
      // cantidad y pesa 218-754 kB, mas de lo que el parser del servidor
      // aceptaba, y ese 413 la tablet lo leia como "sin red" — reenviando
      // exactamente el mismo lote en cada sincronizacion, para siempre y en
      // silencio. Ver `lotes.ts` y MAX_BYTES_POR_LOTE.
      //
      // Cada lote es independiente: si el tercero falla por red, los dos
      // primeros ya quedaron aplicados y no se vuelven a mandar.
      const lotes = trocearLotes(operaciones, {
        maxOperaciones: MAX_OPERACIONES_POR_LOTE,
        maxBytes: MAX_BYTES_POR_LOTE,
      });
      for (const lote of lotes) {
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

  /**
   * Sube, una por una, las fotos de los prospectos ya sincronizados.
   *
   * Una por una y no en lote a proposito: **una foto que falla no puede llevarse
   * a las demas**, ni mucho menos al prospecto. Cada `POST` es independiente y
   * su resultado se anota solo en las columnas de foto de su fila.
   *
   * El reparto de los fallos es el de `api-foto.ts`, y la diferencia entre los
   * dos ultimos casos importa:
   *
   * - **Permanente** (413, 415, el archivo local ya no esta): se descarta. Son
   *   juicios sobre *estos bytes*; reintentar da la misma respuesta para siempre.
   * - **Temporal** (404, 409, 403, 400, 5xx): se anota y sigue en la cola. El
   *   problema es de *esta pasada*, no de la foto.
   * - **Sin red o sesion caida**: se anota y se **corta el paso**. No es un
   *   problema de esta foto sino del canal, asi que intentar las siguientes solo
   *   gastaria tiempo con el vendedor esperando. Las demas siguen en la cola,
   *   intactas.
   * - **Cualquier otra cosa**: se propaga. Es un bug.
   */
  async function subirFotos(token: string): Promise<ResumenFotos> {
    const total: ResumenFotos = {
      intentadas: 0,
      subidas: 0,
      pendientes: 0,
      descartadas: 0,
    };

    for (const foto of fotos.fuente.pendientes()) {
      total.intentadas += 1;
      try {
        const subidaEn = await fotos.api.subir(token, foto.clave, foto.uri);
        fotos.fuente.marcarSubida(foto.clave, subidaEn);
        total.subidas += 1;
      } catch (error) {
        if (error instanceof FotoPermanenteError) {
          fotos.fuente.descartar(foto.clave, error.message);
          total.descartadas += 1;
          continue;
        }
        if (error instanceof FotoTemporalError) {
          fotos.fuente.anotarError(foto.clave, error.message);
          total.pendientes += 1;
          continue;
        }
        if (error instanceof SinRedError || error instanceof SesionRechazadaError) {
          fotos.fuente.anotarError(foto.clave, error.message);
          total.pendientes += 1;
          break;
        }
        throw error;
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
  if (error instanceof LoteDemasiadoGrandeError) {
    return { motivo: 'lote-grande', detalle: error.message };
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
    // T-20: un servidor anterior a T-20 no manda estos campos; con `?? 0` y
    // `?? []` la tablet nueva no revienta el NOT NULL de su esquema.
    clientes: c.clientes.map((cliente) => ({
      ...cliente,
      saldo_favor_centavos: cliente.saldo_favor_centavos ?? 0,
    })),
    // T-40: un servidor anterior a este ticket no manda la coleccion. Se pasa
    // `undefined` y `guardarSnapshot` simplemente no escribe nada de esa tabla;
    // la pantalla de prospectos se queda sin desplegable y lo dice. Es lo que el
    // contrato §3 pide de un cambio aditivo: ignorar lo que no se conoce.
    tiposNegocio: c.tipos_negocio,
    precios: c.precios,
    notas: respuesta.notas_pendientes.map(({ abonos, ...nota }) => ({
      ...nota,
      abonos_json: JSON.stringify(abonos ?? []),
    })),
  };
}

function contarFilas(snapshot: SnapshotCatalogos): number {
  return Object.values(snapshot).reduce(
    (total, filas) => total + (filas?.length ?? 0),
    0,
  );
}
