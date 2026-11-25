import type { ParametrosSQL } from '../base-datos';
import { leerReparto } from '../cobranzas-reglas';
import {
  diasDeAtraso,
  errorDeComentario,
  LARGO_MAX_COMENTARIO_NO_COBRADA,
  motivoBloqueoVenta,
  type NotaAsignadaDeHoy,
} from '../notas-asignadas-reglas';
import type { CondicionVenta, FechaISO, NotaNoCobrada } from '../tipos';
import { enTransaccion, type DepsRepositorio } from './deps';
import { exigirJornadaAbierta } from './jornadas';

export { LARGO_MAX_COMENTARIO_NO_COBRADA };

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

/** Un solo "Continuar sin cobrar" sobre varias notas: el mismo comentario en cada una. */
export interface DatosNotasNoCobradasLocal {
  vendedorId: string;
  clienteId: string;
  ventaNotaIds: readonly string[];
  /** Tal cual lo escribio; se recorta al guardar. */
  comentario: string;
}

/**
 * Una nota por cobrar que el vendedor trae hoy (rediseño pieza 5). `asignada`:
 * la oficina se la asigno; `nueva`: venta a credito de hoy de esta tablet.
 */
export interface NotaQueTrae {
  origen: 'asignada' | 'nueva';
  clienteId: string;
  folio: string;
  /** `null` = venta de hoy que todavia no baja como `nota_pendiente`. */
  ventaNotaId: string | null;
  /** La venta de esta tablet con ese folio; `null` si se vendio en otro lado. */
  ventaId: string | null;
  /** El de la nota; sin bajar, total − abono al vender. */
  saldoCentavos: number;
  /** De la nota (asignada) o de la venta (nueva). */
  fecha: FechaISO;
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

  /**
   * @throws {ErrorJornada} si el dia de hoy ya esta cerrado: primero el candado.
   * @throws {ErrorNotaNoCobrada} si el comentario recortado esta vacio o pasa de 300.
   */
  function exigirComentario(vendedorId: string, texto: string): string {
    exigirJornadaAbierta({ bd, reloj }, vendedorId);
    const comentario = texto.trim();
    const error = errorDeComentario(comentario);
    if (error !== null) throw new ErrorNotaNoCobrada(error);
    return comentario;
  }

  /** Graba una fila ya validada. Cada vez es una fila nueva (no se edita ni se borra). */
  function insertar(
    datos: Omit<DatosNotaNoCobradaLocal, 'comentario'>,
    comentario: string,
  ): NotaNoCobrada {
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
  }

  const repo = {
    /** Las asignadas de hoy del cliente, saldo 0 incluido. Orden: fecha y folio de la nota. */
    deHoyDelCliente(clienteId: string): NotaAsignadaDeHoy[] {
      return deHoy(clienteId);
    },

    /**
     * Las notas por cobrar que **trae** el vendedor hoy: la regla unica del
     * numero de la ruta (spec del rediseño, §4) y del filtro "Notas
     * pendientes" de Ventas / Cobranza (§16-bis). `queTraePorCliente` la cuenta;
     * no se re-deriva en otro lado.
     *
     * - Asignadas de hoy con saldo > 0 y **no liquidadas hoy** (un abono que no
     *   liquida la deja contando: la nota de papel sigue en su mano). No es
     *   `porAtender`, que saca cualquier nota tocada hoy. Orden: fecha y folio.
     * - Mas las ventas **a credito** de hoy de este vendedor, en orden de
     *   captura. Una que ya bajo como `nota_pendiente` (mismo `folio`) cuenta
     *   solo si esa nota sigue activa, con saldo y sin liquidar hoy en la
     *   tablet; si ademas esta asignada, ya la conto la asignacion y no sale dos
     *   veces. Sin bajar, su saldo es total − abono al vender.
     *
     * `ventaId` es la venta de esta tablet con ese folio, si la hay.
     */
    queTraeDelVendedor(vendedorId: string): NotaQueTrae[] {
      const hoy = reloj.hoy();
      const lista: NotaQueTrae[] = [];

      const asignadas = new Set<string>();
      for (const n of deHoy(null)) {
        asignadas.add(n.ventaNotaId);
        if (n.saldoCentavos > 0 && !n.liquidadaHoy) {
          const venta = bd.getFirstSync<{ id: string }>('select id from venta where folio = $folio', {
            $folio: n.folio,
          });
          lista.push({
            origen: 'asignada',
            clienteId: n.clienteId,
            folio: n.folio,
            ventaNotaId: n.ventaNotaId,
            ventaId: venta?.id ?? null,
            saldoCentavos: n.saldoCentavos,
            fecha: n.fecha,
          });
        }
      }

      const ventas = bd.getAllSync<{
        id: string;
        cliente_id: string;
        folio: string;
        fecha: FechaISO;
        monto_total_centavos: number;
        abono_centavos: number | null;
        nota_id: string | null;
        nota_activo: number | null;
        nota_saldo: number | null;
      }>(
        `select v.id, v.cliente_id, v.folio, v.fecha, v.monto_total_centavos, v.abono_centavos,
                np.id as nota_id, np.activo as nota_activo, np.saldo_centavos as nota_saldo
           from venta v
           left join nota_pendiente np on np.folio = v.folio
          where v.vendedor_id = $vendedor_id and v.fecha = $hoy and v.contado_credito = 'credito'
          order by v.rowid`,
        { $vendedor_id: vendedorId, $hoy: hoy },
      );
      if (ventas.length === 0) return lista;

      const liquidadas = new Set<string>();
      for (const c of bd.getAllSync<{ reparto_json: string }>(
        'select reparto_json from cobranza where fecha = $hoy',
        { $hoy: hoy },
      )) {
        for (const r of leerReparto(c.reparto_json)) {
          if (r.saldo_despues_centavos === 0) liquidadas.add(r.venta_nota_id);
        }
      }

      for (const v of ventas) {
        const base = { origen: 'nueva' as const, clienteId: v.cliente_id, folio: v.folio, ventaId: v.id, fecha: v.fecha };
        if (v.nota_id === null) {
          lista.push({
            ...base,
            ventaNotaId: null,
            saldoCentavos: v.monto_total_centavos - (v.abono_centavos ?? 0),
          });
          continue;
        }
        if (asignadas.has(v.nota_id)) continue;
        if (v.nota_activo === 1 && (v.nota_saldo ?? 0) > 0 && !liquidadas.has(v.nota_id)) {
          lista.push({ ...base, ventaNotaId: v.nota_id, saldoCentavos: v.nota_saldo ?? 0 });
        }
      }
      return lista;
    },

    /**
     * Cuantas notas por cobrar **trae** el vendedor de cada cliente hoy: el
     * numero de la fila de la ruta (spec del rediseño, §4). Sin entrada = 0.
     * Es el conteo de `queTraeDelVendedor`, la regla unica.
     */
    queTraePorCliente(vendedorId: string): Map<string, number> {
      const conteo = new Map<string, number>();
      for (const n of repo.queTraeDelVendedor(vendedorId)) {
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
      const comentario = exigirComentario(datos.vendedorId, datos.comentario);
      return insertar(datos, comentario);
    },

    /**
     * "Continuar sin cobrar" sobre varias notas a la vez (la pantalla de la
     * nota): una fila por nota con el mismo comentario, **todo o nada** en una
     * transaccion. Sin notas lanza `ErrorNotaNoCobrada`. Mismos errores que `registrarNoCobrada`, antes de escribir.
     */
    registrarNoCobradas(datos: DatosNotasNoCobradasLocal): NotaNoCobrada[] {
      const comentario = exigirComentario(datos.vendedorId, datos.comentario);
      if (datos.ventaNotaIds.length === 0) throw new ErrorNotaNoCobrada('No hay notas por atender.');
      return enTransaccion(bd, () =>
        datos.ventaNotaIds.map((ventaNotaId) =>
          insertar({ vendedorId: datos.vendedorId, clienteId: datos.clienteId, ventaNotaId }, comentario),
        ),
      );
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
