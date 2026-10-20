import type { FechaISO, Gasto, MomentoISO } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import { enTransaccion, type DepsRepositorio } from './deps';
import { exigirJornadaAbierta } from './jornadas';
import { LARGO_MAX_COMENTARIO_GASTO, MAX_MONTO_GASTO_CENTAVOS, montoGastoValido } from '../reglas-gasto';

/** Error de regla de negocio del gasto (no un fallo tecnico de SQLite). */
export class ErrorGasto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorGasto';
  }
}

// Las reglas viven en un solo modulo, compartido con la logica pura de la pantalla.
export { LARGO_MAX_COMENTARIO_GASTO, MAX_MONTO_GASTO_CENTAVOS };

/** Lo que guarda la pantalla, ya validado por `validarGasto` (`src/estado/gasto.ts`). */
export interface DatosRegistroGasto {
  vendedorId: string;
  campoEgresoId: string;
  /** Entero, de 1 a {@link MAX_MONTO_GASTO_CENTAVOS}. */
  montoCentavos: number;
  comentario: string | null;
  /** Ruta local de la foto del ticket ya comprimida, o `null` (es opcional, D9). */
  fotoUri: string | null;
}

export type RepositorioGastos = ReturnType<typeof crearRepositorioGastos>;

/**
 * Los gastos de la ruta (T-30/T-31, D8): grabar, consultar el dia y las dos
 * colas (push y fotos). El metodo no se guarda: en la app siempre es
 * "Efectivo cobranza del día" y el servidor lo fija al proyectar.
 *
 * Un gasto grabado **no se edita ni se borra** en la app (D9): las correcciones
 * son del portal. Por eso no hay `editar` ni `eliminar` aqui.
 *
 * Recibe `catalogos` ya creado, como las visitas: es quien publica la version
 * que observan las pantallas y quien sabe que campos conoce la tablet.
 */
export function crearRepositorioGastos(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  const repo = {
    /**
     * Graba un gasto en **una sola transaccion**, listo para subir.
     *
     * @throws {ErrorJornada} si el dia de hoy ya esta cerrado (T-38): primero el candado.
     * @throws {ErrorGasto} si la captura no se puede grabar.
     */
    registrar(datos: DatosRegistroGasto): Gasto {
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const vendedor = bd.getFirstSync<{ sucursal_id: string }>(
        'select sucursal_id from vendedor where id = $id',
        { $id: datos.vendedorId },
      );
      if (!vendedor) {
        throw new ErrorGasto('Este vendedor no está en la tablet. Sincroniza antes de registrar el gasto.');
      }

      // Activo o no, con casilla o sin ella: si el pull lo cambio con el
      // formulario abierto, el gasto se guarda igual (D5: el servidor tampoco
      // revisa "Se usa en la app"). Solo uno desconocido es un error.
      const campo = catalogos.obtenerCampoEgreso(datos.campoEgresoId);
      if (!campo) {
        throw new ErrorGasto('Ese campo no está en el catálogo de la tablet. Sincroniza y vuelve a elegirlo.');
      }

      if (!montoGastoValido(datos.montoCentavos)) {
        throw new ErrorGasto('El monto tiene que ser mayor que $0, con dos decimales a lo más.');
      }

      const comentario = recortar(datos.comentario);
      if (comentario !== null && comentario.length > LARGO_MAX_COMENTARIO_GASTO) {
        throw new ErrorGasto(
          `Las observaciones no pueden pasar de ${LARGO_MAX_COMENTARIO_GASTO} caracteres.`,
        );
      }

      const id = generarId();
      enTransaccion(bd, () => {
        bd.runSync(
          `insert into gasto (
             id, fecha, vendedor_id, sucursal_id, campo_egreso_id, campo_nombre,
             monto_centavos, comentario, registrado_en, foto_local, sync_estado
           ) values (
             $id, $fecha, $vendedor_id, $sucursal_id, $campo_egreso_id, $campo_nombre,
             $monto_centavos, $comentario, $registrado_en, $foto_local, 'pendiente'
           )`,
          {
            $id: id,
            // El dia de trabajo de la tablet (Tijuana): viaja como `fecha_operacion`
            // y el servidor nunca lo re-deriva de UTC.
            $fecha: reloj.hoy(),
            $vendedor_id: datos.vendedorId,
            $sucursal_id: vendedor.sucursal_id,
            $campo_egreso_id: campo.id,
            $campo_nombre: campo.nombre,
            $monto_centavos: datos.montoCentavos,
            $comentario: comentario,
            // La hora se toma al guardar.
            $registrado_en: reloj.ahora(),
            $foto_local: datos.fotoUri,
          },
        );
      });

      // Despues del commit: la lista de "Gastos de hoy" relee. Si un oyente
      // truena, el gasto ya esta grabado (mismo criterio que la visita).
      try {
        catalogos.publicarCambio();
      } catch {
        // Solo se pierde el refresco de pantallas abiertas.
      }

      const grabado = repo.porId(id);
      if (!grabado) throw new ErrorGasto('No se pudo leer el gasto recién grabado.');
      return grabado;
    },

    porId(id: string): Gasto | null {
      return bd.getFirstSync<Gasto>('select * from gasto where id = $id', { $id: id });
    },

    /** Gastos del vendedor en un dia, en orden de captura ("Gastos de hoy"). */
    delDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): Gasto[] {
      return bd.getAllSync<Gasto>(
        `select * from gasto where vendedor_id = $vendedor_id and fecha = $fecha
          order by registrado_en, rowid`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
    },

    /**
     * El total del dia, en centavos. Suma **todos** los gastos del dia, sin mirar
     * `sync_estado`: el efectivo ya salio de la bolsa del vendedor aunque el
     * servidor todavia no lo tenga, o lo haya rechazado.
     */
    totalDelDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): number {
      const fila = bd.getFirstSync<{ total: number }>(
        `select coalesce(sum(monto_centavos), 0) as total from gasto
          where vendedor_id = $vendedor_id and fecha = $fecha`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
      return fila?.total ?? 0;
    },

    /**
     * Lo que falta por subir, incluidos los rechazados (patron D19 de T-16):
     * se reintentan en la siguiente sincronizacion; la clave no cambia.
     */
    pendientesDeSincronizar(): Gasto[] {
      return bd.getAllSync<Gasto>(
        `select * from gasto where sync_estado in ('pendiente', 'error')
          order by fecha, registrado_en, rowid`,
      );
    },

    marcarSincronizada(id: string): void {
      bd.runSync(
        `update gasto set sync_estado = 'sincronizado', sincronizado_en = $en, sync_error = null
          where id = $id`,
        { $en: reloj.ahora(), $id: id },
      );
    },

    marcarError(id: string, motivo: string): void {
      bd.runSync(`update gasto set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },

    // ----------------------------------------------------------------------
    // La foto del ticket (D8). Mismo reparto que la de la visita (`visitas.ts`):
    // estos `update` no mencionan `sync_estado` ni `sync_error`. Una foto que
    // falla no se lleva el gasto.
    // ----------------------------------------------------------------------

    /** Fotos por subir: de gastos ya sincronizados (antes no existe su fila arriba). */
    pendientesDeSubirFoto(): Gasto[] {
      return bd.getAllSync<Gasto>(
        `select * from gasto
          where sync_estado = 'sincronizado'
            and foto_local is not null
            and foto_subida_en is null
            and foto_descartada = 0
          order by fecha, registrado_en, rowid`,
      );
    },

    marcarFotoSubida(id: string, subidaEn: MomentoISO): void {
      bd.runSync(`update gasto set foto_subida_en = $en, foto_error = null where id = $id`, {
        $en: subidaEn,
        $id: id,
      });
    },

    anotarErrorFoto(id: string, motivo: string): void {
      bd.runSync(`update gasto set foto_error = $motivo where id = $id`, { $motivo: motivo, $id: id });
    },

    descartarFoto(id: string, motivo: string): void {
      bd.runSync(`update gasto set foto_descartada = 1, foto_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },
  };

  return repo;
}

/** Texto recortado no vacio, o `null`. */
function recortar(valor: string | null): string | null {
  if (valor === null) return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}
