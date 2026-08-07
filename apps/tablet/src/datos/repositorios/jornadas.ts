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
     * TODO: T-38 — el corte del dia (cobranza, gastos, comision, efectividad)
     *       se calcula y se imprime en su propio ticket; aqui solo se cierra la
     *       jornada.
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
     * TODO: T-07 — la usara el `push` del cierre de dia.
     */
    pendientesDeSincronizar(): Jornada[] {
      return bd.getAllSync<Jornada>(
        `select * from jornada
         where sync_estado in ('pendiente', 'error')
         order by fecha, abierta_en`,
      );
    },

    /** Marca una jornada como ya subida. TODO: T-07. */
    marcarSincronizada(jornadaId: string): void {
      bd.runSync(
        `update jornada set sync_estado = 'sincronizado', sincronizado_en = $sincronizado_en
         where id = $id`,
        { $sincronizado_en: reloj.ahora(), $id: jornadaId },
      );
    },
  };

  return repo;
}
