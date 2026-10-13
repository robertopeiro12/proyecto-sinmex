import { esFechaReal } from '../ventas-cobranza/venta-portal';

/**
 * Reporte de Kilometraje (T-50): las reglas sin base de datos.
 *
 * El SQL (`ReporteKilometrajeRepository`) trae filas planas ya ordenadas por
 * vehiculo y por `fecha, cerrada_en, id`, cada una con el `km_final` de la
 * jornada ANTERIOR del mismo vehiculo (`lag`), aunque esa anterior caiga antes
 * de `desde`. Aqui se agrupa, se calcula el salto y se suma. Todo en DECIMAS de
 * km enteras: `jornada.km_*` es `numeric(10,1)` y asi no hay flotantes.
 */

/** Un año con bisiesto, contando los dos extremos. */
export const MAX_DIAS_RANGO = 366;

const MS_DIA = 24 * 60 * 60 * 1000;

/** El mensaje del 400, o `null` si el rango sirve. El formato ya lo valido el DTO. */
export function validarRango(desde: string, hasta: string): string | null {
  if (!esFechaReal(desde)) return 'La fecha "desde" no es una fecha válida.';
  if (!esFechaReal(hasta)) return 'La fecha "hasta" no es una fecha válida.';
  if (desde > hasta)
    return 'La fecha "desde" no puede ser posterior a "hasta".';
  const dias =
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) /
      MS_DIA +
    1;
  if (dias > MAX_DIAS_RANGO) return 'El rango no puede pasar de un año.';
  return null;
}

/** Lo que trae el SQL por jornada. */
export interface FilaJornada {
  jornadaId: string;
  vehiculoId: string;
  vehiculoNombre: string;
  placas: string | null;
  vehiculoActivo: boolean;
  /** `AAAA-MM-DD`. */
  fecha: string;
  vendedor: string;
  kmInicialDecimas: number;
  kmFinalDecimas: number;
  /** `km_final` de la jornada anterior del mismo vehiculo; `null` si no hay. */
  kmFinalAnteriorDecimas: number | null;
  fechaAnterior: string | null;
}

export interface JornadaEnReporte {
  jornadaId: string;
  fecha: string;
  vendedor: string;
  kmInicialDecimas: number;
  kmFinalDecimas: number;
  kilometrosDecimas: number;
  /** `null` = sin jornada anterior; `0` = empezó donde terminó la anterior. */
  saltoDecimas: number | null;
  fechaAnterior: string | null;
}

export interface VehiculoEnReporte {
  vehiculoId: string;
  nombre: string;
  placas: string | null;
  activo: boolean;
  jornadas: JornadaEnReporte[];
  totalKilometrosDecimas: number;
  totalSaltoDecimas: number;
}

export interface ReporteKilometraje {
  desde: string;
  hasta: string;
  vehiculos: VehiculoEnReporte[];
  totalKilometrosDecimas: number;
  totalSaltoDecimas: number;
}

/** Nombre y luego placas; un vehiculo sin placas va al final de su nombre. */
function compararVehiculos(a: VehiculoEnReporte, b: VehiculoEnReporte): number {
  const porNombre = a.nombre.localeCompare(b.nombre, 'es');
  if (porNombre !== 0) return porNombre;
  if (a.placas === b.placas) return a.vehiculoId.localeCompare(b.vehiculoId);
  if (a.placas === null) return 1;
  if (b.placas === null) return -1;
  return a.placas.localeCompare(b.placas, 'es');
}

/**
 * Agrupa por vehiculo conservando el orden en que llegan las jornadas: es el
 * orden del SQL, el mismo con el que se calculo el salto.
 */
export function armarReporte(
  desde: string,
  hasta: string,
  filas: readonly FilaJornada[],
): ReporteKilometraje {
  const porVehiculo = new Map<string, VehiculoEnReporte>();

  for (const f of filas) {
    let vehiculo = porVehiculo.get(f.vehiculoId);
    if (!vehiculo) {
      vehiculo = {
        vehiculoId: f.vehiculoId,
        nombre: f.vehiculoNombre,
        placas: f.placas,
        activo: f.vehiculoActivo,
        jornadas: [],
        totalKilometrosDecimas: 0,
        totalSaltoDecimas: 0,
      };
      porVehiculo.set(f.vehiculoId, vehiculo);
    }

    const kilometrosDecimas = f.kmFinalDecimas - f.kmInicialDecimas;
    const saltoDecimas =
      f.kmFinalAnteriorDecimas === null
        ? null
        : f.kmInicialDecimas - f.kmFinalAnteriorDecimas;

    vehiculo.jornadas.push({
      jornadaId: f.jornadaId,
      fecha: f.fecha,
      vendedor: f.vendedor,
      kmInicialDecimas: f.kmInicialDecimas,
      kmFinalDecimas: f.kmFinalDecimas,
      kilometrosDecimas,
      saltoDecimas,
      fechaAnterior: f.fechaAnterior,
    });
    vehiculo.totalKilometrosDecimas += kilometrosDecimas;
    vehiculo.totalSaltoDecimas += saltoDecimas ?? 0;
  }

  const vehiculos = [...porVehiculo.values()].sort(compararVehiculos);
  return {
    desde,
    hasta,
    vehiculos,
    totalKilometrosDecimas: vehiculos.reduce(
      (t, v) => t + v.totalKilometrosDecimas,
      0,
    ),
    totalSaltoDecimas: vehiculos.reduce((t, v) => t + v.totalSaltoDecimas, 0),
  };
}
