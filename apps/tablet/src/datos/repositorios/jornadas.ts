import type { DepsRepositorio } from './deps';
import type { Jornada } from '../tipos';

/** Error de regla de negocio de la jornada (no un fallo tecnico de SQLite). */
export class ErrorJornada extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorJornada';
  }
}

export interface DatosAperturaJornada {
  vendedorId: string;
  vehiculoId: string;
  kmInicial: number;
}

export type RepositorioJornadas = ReturnType<typeof crearRepositorioJornadas>;

/**
 * La jornada del vendedor: abrir el dia, cerrarlo y saber que falta subir.
 *
 * Es la **entidad operativa** que existe en T-04 porque es estructural: sin
 * jornada abierta la app no deja operar (ver [[App Tablet]], "Abrir el dia").
 * Las demas entidades operativas (venta, cobranza, gasto, merma...) llegan con
 * sus propios tickets siguiendo este mismo patron.
 */
export function crearRepositorioJornadas({ bd, reloj, generarId }: DepsRepositorio) {
  const repo = {
    /**
     * Abre el dia: vehiculo + kilometraje inicial.
     *
     * Falla si el vendedor ya abrio el dia. El kilometraje inicial **no se
     * corrige** reabriendo: alimenta el reporte de Kilometraje del portal y
     * corregirlo en silencio ocultaria un desvio del vehiculo.
     */
    abrir({ vendedorId, vehiculoId, kmInicial }: DatosAperturaJornada): Jornada {
      if (!Number.isFinite(kmInicial) || kmInicial < 0) {
        throw new ErrorJornada('El kilometraje inicial debe ser un numero mayor o igual a cero.');
      }

      const fecha = reloj.hoy();
      if (repo.deHoy(vendedorId)) {
        throw new ErrorJornada(`El vendedor ya abrio el dia ${fecha}.`);
      }

      const ahora = reloj.ahora();
      const id = generarId();
      bd.runSync(
        `insert into jornada (
           id, fecha, vendedor_id, vehiculo_id, km_inicial, abierta_en,
           estado, sync_estado, actualizado_local_en
         ) values (
           $id, $fecha, $vendedor_id, $vehiculo_id, $km_inicial, $abierta_en,
           'abierta', 'pendiente', $actualizado_local_en
         )`,
        {
          $id: id,
          $fecha: fecha,
          $vendedor_id: vendedorId,
          $vehiculo_id: vehiculoId,
          $km_inicial: kmInicial,
          $abierta_en: ahora,
          $actualizado_local_en: ahora,
        },
      );

      const jornada = repo.porId(id);
      if (!jornada) throw new ErrorJornada('No se pudo leer la jornada recien creada.');
      return jornada;
    },

    /**
     * La jornada del vendedor para **hoy**, o `null` si aun no ha abierto el
     * dia. Es la consulta que alimenta el bloqueo de navegacion.
     */
    deHoy(vendedorId: string): Jornada | null {
      return bd.getFirstSync<Jornada>(
        'select * from jornada where vendedor_id = $vendedor_id and fecha = $fecha',
        { $vendedor_id: vendedorId, $fecha: reloj.hoy() },
      );
    },

    porId(id: string): Jornada | null {
      return bd.getFirstSync<Jornada>('select * from jornada where id = $id', { $id: id });
    },

    /**
     * Cierra el dia con el kilometraje final.
     *
     * El odometro no retrocede: un km final menor al inicial es un error de
     * captura, y dejarlo pasar produciria kilometraje negativo en el reporte
     * del portal.
     *
     * > [!important] T-38: esta funcion ES el candado del km final
     * > "Km final obligatorio antes de enviar el corte" ([[App Tablet]], §5) se
     * > cumple porque `km_final` **solo** se puede escribir por aqui, y aqui no
     * > hay forma de cerrar sin darlo: un `kmFinal` ausente o ilegible es `NaN`,
     * > que `Number.isFinite` rechaza. No hay una segunda ruta de escritura.
     * >
     * > TODO: T-33 — el corte del dia (ventas por presentacion, cobranza,
     * >       gastos, tesoreria, comision, efectividad e impresion) se calcula
     * >       en su propio ticket; aqui solo se cierra la jornada. Lo que T-33
     * >       tiene que **conectar** es una sola condicion: la accion de enviar
     * >       el corte exige `jornada.estado === 'cerrada'`. No hace falta que
     * >       revalide el kilometraje —si esta cerrada, paso por aqui— pero si
     * >       que no ofrezca el envio sobre una jornada abierta, porque hoy
     * >       nada mas lo impide: el guardia de `(jornada)/_layout.tsx` exige
     * >       jornada, no jornada cerrada. Mientras T-33 no exista, el unico
     * >       camino al corte es la tarjeta de `cerrar-dia.tsx`, que se pinta
     * >       solo en la rama de `estado === 'cerrada'`.
     */
    cerrar(jornadaId: string, kmFinal: number): Jornada {
      const jornada = repo.porId(jornadaId);
      if (!jornada) throw new ErrorJornada(`No existe la jornada ${jornadaId}.`);
      if (jornada.estado === 'cerrada') {
        throw new ErrorJornada('La jornada ya esta cerrada.');
      }
      if (!Number.isFinite(kmFinal) || kmFinal < jornada.km_inicial) {
        throw new ErrorJornada(
          `El kilometraje final (${kmFinal}) no puede ser menor al inicial (${jornada.km_inicial}).`,
        );
      }

      const ahora = reloj.ahora();
      bd.runSync(
        `update jornada set
           km_final = $km_final,
           cerrada_en = $cerrada_en,
           estado = 'cerrada',
           sync_estado = 'pendiente',
           actualizado_local_en = $actualizado_local_en
         where id = $id`,
        {
          $km_final: kmFinal,
          $cerrada_en: ahora,
          $actualizado_local_en: ahora,
          $id: jornadaId,
        },
      );

      const cerrada = repo.porId(jornadaId);
      if (!cerrada) throw new ErrorJornada('No se pudo leer la jornada recien cerrada.');
      return cerrada;
    },

    /**
     * Jornadas que faltan por subir al portal.
     *
     * Incluye las que quedaron en `error`: un rechazo puede deberse a un dato
     * que el portal corrigio despues (un vehiculo que estaba de baja, por
     * ejemplo), asi que se vuelve a intentar. Reintentar es seguro porque el
     * `push` es idempotente: la clave es el `id` de la fila, que no cambia.
     */
    pendientesDeSincronizar(): Jornada[] {
      return bd.getAllSync<Jornada>(
        `select * from jornada
         where sync_estado in ('pendiente', 'error')
         order by fecha, abierta_en`,
      );
    },

    /** Marca una jornada como ya subida y limpia el error de un intento previo. */
    marcarSincronizada(jornadaId: string): void {
      bd.runSync(
        `update jornada set
           sync_estado = 'sincronizado',
           sincronizado_en = $sincronizado_en,
           sync_error = null
         where id = $id`,
        { $sincronizado_en: reloj.ahora(), $id: jornadaId },
      );
    },

    /**
     * El servidor rechazo esta jornada y dijo por que.
     *
     * Se guarda el motivo, no solo el estado: sin el, una fila en `error` es un
     * callejon sin salida — nadie sabria que paso ni podria decirselo al
     * vendedor. Sigue apareciendo en `pendientesDeSincronizar()` para que el
     * proximo intento la vuelva a mandar.
     */
    marcarError(jornadaId: string, motivo: string): void {
      bd.runSync(
        `update jornada set sync_estado = 'error', sync_error = $motivo where id = $id`,
        { $motivo: motivo, $id: jornadaId },
      );
    },
  };

  return repo;
}
