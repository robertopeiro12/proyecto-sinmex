import type { FilaViva } from './reemplazo-ruta';

/** Una fecha (AAAA-MM-DD) se puede editar si es de `hoy` (de Tijuana) o posterior. */
export function esFechaEditable(fecha: string, hoy: string): boolean {
  return fecha >= hoy;
}

/** Dia de la semana de una fecha AAAA-MM-DD: 1 = lunes ... 6 = sabado; domingo = null. */
export function diaSemanaDe(fecha: string): number | null {
  const [a, m, d] = fecha.split('-').map(Number);
  // Date.UTC + getUTCDay: nunca depende de la zona del proceso.
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  return dia === 0 ? null : dia;
}

/** Lo que hay que escribir en la ruta de un dia cuando cambia la ruta semanal. */
export interface PlanPropagacion {
  /** Origen `semanal`. */
  insertar: { clienteId: string; orden: number }[];
  /** `quitado_por` = `cambio_ruta`. */
  borrar: { id: string; clienteId: string }[];
}

export function planearPropagacion(
  vivasDelDia: readonly FilaViva[],
  agregados: readonly string[],
  quitados: ReadonlySet<string>,
  quitadosAManoEseDia: ReadonlySet<string>,
  clientesValidos: ReadonlySet<string>,
): PlanPropagacion {
  const vivos = new Set(vivasDelDia.map((f) => f.clienteId));
  let orden = vivasDelDia.reduce((max, f) => Math.max(max, f.orden), 0);

  const insertar: PlanPropagacion['insertar'] = [];
  for (const clienteId of agregados) {
    if (
      vivos.has(clienteId) ||
      quitadosAManoEseDia.has(clienteId) ||
      !clientesValidos.has(clienteId)
    ) {
      continue;
    }
    vivos.add(clienteId);
    orden += 1;
    insertar.push({ clienteId, orden });
  }

  const borrar = vivasDelDia
    .filter((f) => f.origen === 'semanal' && quitados.has(f.clienteId))
    .map((f) => ({ id: f.id, clienteId: f.clienteId }));

  return { insertar, borrar };
}

const DIAS = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
];
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Nombre del dia para los mensajes: 1 = "lunes" ... 6 = "sábado" (7 = "domingo", que no es dia de ruta). */
export function nombreDia(diaSemana: number): string {
  return DIAS[diaSemana - 1];
}

/** "martes 10 de noviembre" de una fecha AAAA-MM-DD (sin año, como el resto del portal). */
export function fechaLarga(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number);
  // 0 = domingo en getUTCDay; DIAS arranca en lunes.
  const dia = (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7;
  return `${DIAS[dia]} ${d} de ${MESES[m - 1]}`;
}
