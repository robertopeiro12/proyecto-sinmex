import type { FechaISO, MomentoISO, Visita } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import { enTransaccion, type DepsRepositorio } from './deps';
import { exigirJornadaAbierta } from './jornadas';

/** Error de regla de negocio de la visita (no un fallo tecnico de SQLite). */
export class ErrorVisita extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorVisita';
  }
}

/** Los mismos topes que el servidor (`rutas/datos-visita.ts`). */
export const LARGO_MAX_OBSERVACIONES_VISITA = 500;
export const LARGO_MAX_ATENDIO = 120;
export const LARGO_MAX_DIRECCION = 300;

/** Lo que guarda la pantalla, ya validado por `validarVisita` (`src/estado/visita.ts`). */
export interface DatosRegistroVisita {
  vendedorId: string;
  clienteId: string;
  motivoVisitaId: string;
  observaciones: string | null;
  atendio: string | null;
  /** Las dos o ninguna. Sin ellas, `direccionTexto` es obligatoria. */
  lat: number | null;
  lng: number | null;
  precisionM: number | null;
  direccionTexto: string | null;
  /** Ruta local de la foto ya comprimida, o `null`. */
  fotoUri: string | null;
}

export type RepositorioVisitas = ReturnType<typeof crearRepositorioVisitas>;

/**
 * La visita sin venta en ruta (T-39): grabar, consultar el dia y las dos colas
 * (push y fotos).
 *
 * Las casillas del motivo (`exige_foto`, `exige_atendio`) las aplica
 * `validarVisita` en la pantalla: este repositorio no las vuelve a revisar
 * porque la capa de datos no importa de `src/estado/`. Lo que si revisa son las
 * reglas que tambien tiene el servidor (ubicacion, topes, motivo conocido), para
 * que una captura imposible no llegue nunca al push.
 *
 * Recibe `catalogos` ya creado, como las ventas: es quien publica la version
 * que observan las pantallas.
 */
export function crearRepositorioVisitas(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  const repo = {
    /**
     * Graba una visita en **una sola transaccion**, lista para subir.
     *
     * @throws {ErrorJornada} si el dia de hoy ya esta cerrado (T-38): primero el candado.
     * @throws {ErrorVisita} si la captura no se puede grabar.
     */
    registrar(datos: DatosRegistroVisita): Visita {
      exigirJornadaAbierta({ bd, reloj }, datos.vendedorId);

      const cliente = catalogos.obtenerCliente(datos.clienteId);
      if (!cliente || cliente.activo !== 1) {
        throw new ErrorVisita(
          'Este cliente ya no está en el catálogo de la tablet. Sincroniza antes de registrar la visita.',
        );
      }
      const vendedor = bd.getFirstSync<{ sucursal_id: string }>(
        'select sucursal_id from vendedor where id = $id',
        { $id: datos.vendedorId },
      );
      if (!vendedor) {
        throw new ErrorVisita('Este vendedor no está en la tablet. Sincroniza antes de registrar la visita.');
      }

      // Activo o no: uno dado de baja despues de elegirlo se guarda igual (D3,
      // el servidor tambien lo acepta). Solo uno desconocido es un error.
      const motivo = catalogos.obtenerMotivoVisita(datos.motivoVisitaId);
      if (!motivo) {
        throw new ErrorVisita('Ese motivo no está en el catálogo de la tablet. Sincroniza y vuelve a elegirlo.');
      }

      const observaciones = recortar(datos.observaciones);
      if (observaciones !== null && observaciones.length > LARGO_MAX_OBSERVACIONES_VISITA) {
        throw new ErrorVisita(
          `Las observaciones no pueden pasar de ${LARGO_MAX_OBSERVACIONES_VISITA} caracteres.`,
        );
      }
      const atendio = recortar(datos.atendio);
      if (atendio !== null && atendio.length > LARGO_MAX_ATENDIO) {
        throw new ErrorVisita(`El nombre de quien atendió no puede pasar de ${LARGO_MAX_ATENDIO} caracteres.`);
      }
      const direccionTexto = recortar(datos.direccionTexto);
      if (direccionTexto !== null && direccionTexto.length > LARGO_MAX_DIRECCION) {
        throw new ErrorVisita(`La dirección no puede pasar de ${LARGO_MAX_DIRECCION} caracteres.`);
      }
      if ((datos.lat === null) !== (datos.lng === null)) {
        throw new ErrorVisita('La ubicación va completa o no va: falta una de las dos coordenadas.');
      }
      if (datos.lat === null && direccionTexto === null) {
        throw new ErrorVisita('Sin ubicación GPS, escribe la dirección o una referencia del lugar.');
      }
      // La precision la da el aparato, no el vendedor: una rara se descarta en vez de bloquear.
      const precisionM =
        datos.precisionM !== null && Number.isFinite(datos.precisionM) && datos.precisionM >= 0
          ? datos.precisionM
          : null;

      const id = generarId();
      enTransaccion(bd, () => {
        bd.runSync(
          `insert into visita (
             id, fecha, cliente_id, vendedor_id, sucursal_id, motivo_visita_id, motivo_nombre,
             visitada_en, observaciones, atendio, lat, lng, precision_m, direccion_texto,
             foto_local, sync_estado
           ) values (
             $id, $fecha, $cliente_id, $vendedor_id, $sucursal_id, $motivo_visita_id, $motivo_nombre,
             $visitada_en, $observaciones, $atendio, $lat, $lng, $precision_m, $direccion_texto,
             $foto_local, 'pendiente'
           )`,
          {
            $id: id,
            // El dia de trabajo de la tablet (Tijuana): viaja como `fecha_operacion`.
            $fecha: reloj.hoy(),
            $cliente_id: datos.clienteId,
            $vendedor_id: datos.vendedorId,
            $sucursal_id: vendedor.sucursal_id,
            $motivo_visita_id: motivo.id,
            $motivo_nombre: motivo.nombre,
            // La hora se toma al guardar (D7).
            $visitada_en: reloj.ahora(),
            $observaciones: observaciones,
            $atendio: atendio,
            $lat: datos.lat,
            $lng: datos.lng,
            $precision_m: precisionM,
            $direccion_texto: direccionTexto,
            $foto_local: datos.fotoUri,
          },
        );
      });

      // Despues del commit: la ruta del dia y la ficha releen. Si un oyente
      // truena, la visita ya esta grabada (mismo criterio que la cobranza).
      try {
        catalogos.publicarCambio();
      } catch {
        // Solo se pierde el refresco de pantallas abiertas.
      }

      const grabada = repo.porId(id);
      if (!grabada) throw new ErrorVisita('No se pudo leer la visita recién grabada.');
      return grabada;
    },

    porId(id: string): Visita | null {
      return bd.getFirstSync<Visita>('select * from visita where id = $id', { $id: id });
    },

    /** Visitas de un cliente en un dia, en orden de captura ("Visitas de hoy" de la ficha). */
    delDia(clienteId: string, fecha: FechaISO = reloj.hoy()): Visita[] {
      return bd.getAllSync<Visita>(
        `select * from visita where cliente_id = $cliente_id and fecha = $fecha
          order by visitada_en, rowid`,
        { $cliente_id: clienteId, $fecha: fecha },
      );
    },

    /** Visitas del vendedor en un dia ("Atendidos fuera de ruta"). */
    delDiaDelVendedor(vendedorId: string, fecha: FechaISO = reloj.hoy()): Visita[] {
      return bd.getAllSync<Visita>(
        `select * from visita where vendedor_id = $vendedor_id and fecha = $fecha
          order by visitada_en, rowid`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
    },

    /**
     * Lo que falta por subir, incluidas las rechazadas (patron D19 de T-16):
     * se reintentan en la siguiente sincronizacion; la clave no cambia.
     */
    pendientesDeSincronizar(): Visita[] {
      return bd.getAllSync<Visita>(
        `select * from visita where sync_estado in ('pendiente', 'error')
          order by fecha, visitada_en, rowid`,
      );
    },

    marcarSincronizada(id: string): void {
      bd.runSync(
        `update visita set sync_estado = 'sincronizado', sincronizado_en = $en, sync_error = null
          where id = $id`,
        { $en: reloj.ahora(), $id: id },
      );
    },

    marcarError(id: string, motivo: string): void {
      bd.runSync(`update visita set sync_estado = 'error', sync_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },

    // ----------------------------------------------------------------------
    // La foto (D9). Mismo reparto que la del prospecto (`prospectos.ts`): estos
    // `update` no mencionan `sync_estado` ni `sync_error`. Una foto que falla no
    // se lleva la visita.
    // ----------------------------------------------------------------------

    /** Fotos por subir: de visitas ya sincronizadas (antes no existe su fila arriba). */
    pendientesDeSubirFoto(): Visita[] {
      return bd.getAllSync<Visita>(
        `select * from visita
          where sync_estado = 'sincronizado'
            and foto_local is not null
            and foto_subida_en is null
            and foto_descartada = 0
          order by fecha, visitada_en, rowid`,
      );
    },

    marcarFotoSubida(id: string, subidaEn: MomentoISO): void {
      bd.runSync(`update visita set foto_subida_en = $en, foto_error = null where id = $id`, {
        $en: subidaEn,
        $id: id,
      });
    },

    anotarErrorFoto(id: string, motivo: string): void {
      bd.runSync(`update visita set foto_error = $motivo where id = $id`, { $motivo: motivo, $id: id });
    },

    descartarFoto(id: string, motivo: string): void {
      bd.runSync(`update visita set foto_descartada = 1, foto_error = $motivo where id = $id`, {
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
