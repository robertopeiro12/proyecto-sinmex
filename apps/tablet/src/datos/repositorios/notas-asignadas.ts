import type { ParametrosSQL } from '../base-datos';
import { leerReparto } from '../cobranzas-reglas';
import {
  diasDeAtraso,
  motivoBloqueoVenta,
  porAtender,
  type NotaAsignadaDeHoy,
} from '../notas-asignadas-reglas';
import type { CondicionVenta, FechaISO, NotaNoCobrada } from '../tipos';
import type { DepsRepositorio } from './deps';
import { exigirJornadaAbierta } from './jornadas';

/** Largo maximo del comentario de "Continuar sin cobrar" (recortado). */
export const LARGO_MAX_COMENTARIO_NO_COBRADA = 300;

/** Error de regla de negocio de "Continuar sin cobrar" (no un fallo tecnico de SQLite). */
export class ErrorNotaNoCobrada extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorNotaNoCobrada';
  }
}

export interface DatosNotaNoCobradaLocal {
  vendedorId: string;
  clienteId: string;
  ventaNotaId: string;
  /** Tal cual lo escribio; se recorta al guardar. */
  comentario: string;
}

export type RepositorioNotasAsignadas = ReturnType<typeof crearRepositorioNotasAsignadas>;

interface FilaAsignada {
  asignacion_id: string;
  venta_nota_id: string;
  cliente_id: string;
  folio: string;
  fecha: FechaISO;
  saldo_centavos: number;
  condicion_venta: CondicionVenta;
  plazo_credito_dias: number | null;
}

/**
 * Las notas que la oficina asigno al vendedor para hoy (spec 2026-11-13) y los
 * comentarios de "Continuar sin cobrar".
 *
 * `nota_asignada` solo la escribe el pull. Una asignacion cuenta si es de
 * `reloj.hoy()`, esta viva y su `nota_pendiente` existe viva; se devuelve
 * **aunque su saldo sea 0**, para que `cumpleCondicion` la vea cumplida:
 * `porAtender` y `motivoBloqueoVenta` son quienes filtran.
 *
 * "Tocada hoy" sale de `cobranza.fecha` = hoy + `reparto_json`, **nunca** de
 * `fecha_pago` ni de `nota_pendiente.abonos_json` (el pull lo pisa y trae
 * abonos de la oficina). "Liquidada hoy" sale del mismo `reparto_json`
 * (`saldo_despues_centavos` = 0). Asi un pull que reescribe el saldo viejo antes de que
 * suba el cobro no desbloquea ni bloquea de mas.
 */
export function crearRepositorioNotasAsignadas({ bd, reloj, generarId }: DepsRepositorio) {
  /** Las asignaciones de hoy, de un cliente o de todos. */
  function deHoy(clienteId: string | null): NotaAsignadaDeHoy[] {
    const hoy = reloj.hoy();
    const filtroCliente = clienteId === null ? '' : 'and np.cliente_id = $cliente_id';
    const params: ParametrosSQL = clienteId === null ? { $hoy: hoy } : { $hoy: hoy, $cliente_id: clienteId };

    const filas = bd.getAllSync<FilaAsignada>(
      `select na.id as asignacion_id, na.venta_nota_id, np.cliente_id, np.folio, np.fecha,
              np.saldo_centavos, na.condicion_venta, c.plazo_credito_dias
         from nota_asignada na
         join nota_pendiente np on np.id = na.venta_nota_id and np.activo = 1
         left join cliente c on c.id = np.cliente_id
        where na.fecha = $hoy and na.activo = 1 ${filtroCliente}
        order by np.fecha, np.folio, na.id`,
      params,
    );
    if (filas.length === 0) return [];

    const tocadas = new Set<string>();
    const liquidadas = new Set<string>();
    const cobros = bd.getAllSync<{ reparto_json: string }>(
      `select reparto_json from cobranza where fecha = $hoy ${clienteId === null ? '' : 'and cliente_id = $cliente_id'}`,
      params,
    );
    for (const c of cobros) {
      for (const r of leerReparto(c.reparto_json)) {
        if (r.monto_centavos > 0) tocadas.add(r.venta_nota_id);
        if (r.saldo_despues_centavos === 0) liquidadas.add(r.venta_nota_id);
      }
    }

    const comentadas = new Set(
      bd
        .getAllSync<{ venta_nota_id: string }>(
          `select distinct venta_nota_id from nota_no_cobrada
            where fecha = $hoy ${clienteId === null ? '' : 'and cliente_id = $cliente_id'}`,
          params,
        )
        .map((f) => f.venta_nota_id),
    );

    return filas.map((f) => ({
      asignacionId: f.asignacion_id,
      ventaNotaId: f.venta_nota_id,
      clienteId: f.cliente_id,
      folio: f.folio,
      fecha: f.fecha,
      saldoCentavos: f.saldo_centavos,
      diasAtraso: diasDeAtraso(f.fecha, f.plazo_credito_dias, hoy),
      condicion: f.condicion_venta,
      tocadaHoy: tocadas.has(f.venta_nota_id),
      liquidadaHoy: liquidadas.has(f.venta_nota_id),
      comentadaHoy: comentadas.has(f.venta_nota_id),
    }));
  }

  const repo = {
    /** Las asignadas de hoy del cliente, saldo 0 incluido. Orden: fecha y folio de la nota. */
    deHoyDelCliente(clienteId: string): NotaAsignadaDeHoy[] {
      return deHoy(clienteId);
    },

    /** Cuantas asignadas por atender tiene cada cliente hoy (la ruta). Sin entrada = 0. */
    conteoDeHoyPorCliente(): Map<string, number> {
      const conteo = new Map<string, number>();
      for (const n of porAtender(deHoy(null))) {
        conteo.set(n.clienteId, (conteo.get(n.clienteId) ?? 0) + 1);
      }
      return conteo;
    },

    /** El motivo por el que la tablet no deja venderle, o `null`. El servidor no rechaza. */
    bloqueoDeVenta(clienteId: string): string | null {
      return motivoBloqueoVenta(deHoy(clienteId));
    },

    /**
     * "Continuar sin cobrar": graba el comentario, listo para subir. Cada vez
     * es una fila nueva (no se edita ni se borra).
     *
     * @throws {ErrorJornada} si el dia de hoy ya esta cerrado: primero el candado.
     * @throws {ErrorNotaNoCobrada} si el comentario recortado esta vacio o pasa de 300.
     */
    registrarNoCobrada(datos: DatosNotaNoCobradaLocal): NotaNoCobrada {
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const comentario = datos.comentario.trim();
      if (comentario === '') throw new ErrorNotaNoCobrada('Escribe por qué no te pagó.');
      if (comentario.length > LARGO_MAX_COMENTARIO_NO_COBRADA) {
        throw new ErrorNotaNoCobrada('El comentario admite hasta 300 caracteres.');
      }

      const id = generarId();
      bd.runSync(
        `insert into nota_no_cobrada (
           id, venta_nota_id, cliente_id, vendedor_id, fecha, comentario, registrado_en, sync_estado
         ) values (
           $id, $venta_nota_id, $cliente_id, $vendedor_id, $fecha, $comentario, $registrado_en, 'pendiente'
         )`,
        {
          $id: id,
          $venta_nota_id: datos.ventaNotaId,
          $cliente_id: datos.clienteId,
          $vendedor_id: datos.vendedorId,
          $fecha: reloj.hoy(),
          $comentario: comentario,
          $registrado_en: reloj.ahora(),
        },
      );

      const grabada = bd.getFirstSync<NotaNoCobrada>('select * from nota_no_cobrada where id = $id', { $id: id });
      // Fallo tecnico, no regla de negocio: no es ErrorNotaNoCobrada.
      if (!grabada) throw new Error('No se pudo leer el comentario recién grabado.');
      return grabada;
    },

    /** Lo que falta por subir, incluidos los rechazados: se reintentan con la misma clave. */
    pendientesDeSincronizar(): NotaNoCobrada[] {
      return bd.getAllSync<NotaNoCobrada>(
        `select * from nota_no_cobrada where sync_estado in ('pendiente', 'error')
          order by fecha, registrado_en, rowid`,
      );
    },

    marcarSincronizada(id: string): void {
      bd.runSync(
        `update nota_no_cobrada set sync_estado = 'sincronizado', sincronizado_en = $en, sync_error = null
          where id = $id`,
        { $en: reloj.ahora(), $id: id },
      );
    },

    marcarError(id: string, motivo: string): void {
      bd.runSync(`update nota_no_cobrada set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },
  };

  return repo;
}
