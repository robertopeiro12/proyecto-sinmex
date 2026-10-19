import { leerMontoCentavos } from '@/datos/cobranzas-reglas';
import { LARGO_MAX_COMENTARIO_GASTO, montoGastoValido } from '@/datos/reglas-gasto';
import type { DatosRegistroGasto } from '@/datos/repositorios/gastos';
import type { CampoEgreso, Gasto } from '@/datos/tipos';

import { motivoDeRechazo, type EstadoPastilla } from './ruta-del-dia';

/**
 * Lo que decide la pantalla "Gastos" (T-30/T-31, D9), sin React: la tablet no
 * tiene pruebas de pantalla, asi que toda la validacion vive aqui y la pantalla
 * solo la pinta (mismo criterio que `visita.ts`).
 */

/** El metodo se muestra fijo: en la app siempre se paga con la cobranza del dia (D9). */
export const TEXTO_METODO_GASTO = 'Efectivo cobranza del día';

/**
 * El texto del campo "Monto" a centavos, **sin coma flotante**: "12.5" son 1250
 * y "0.29" son 29 (con `Math.round(0.29 * 100)` tambien, pero con
 * `0.29 * 100` serian 28.999…). Reusa `leerMontoCentavos` de la cobranza (T-20):
 * solo digitos y punto, hasta dos decimales, al menos un digito antes del punto
 * (".5" no; se escribe "0.50"), sin coma ni signo. Ademas exige mas de $0 y no
 * pasar del tope del servidor. `null` = no se entiende o no vale.
 */
export function montoACentavos(texto: string): number | null {
  const centavos = leerMontoCentavos(texto);
  return centavos !== null && montoGastoValido(centavos) ? centavos : null;
}

/**
 * Los campos que ofrece la pantalla: activos y con "Se usa en la app", por
 * nombre en español ("Adelanto" antes que "gasolina" sin importar mayusculas).
 */
export function camposParaGasto(campos: readonly CampoEgreso[]): CampoEgreso[] {
  return campos
    .filter((c) => c.activo === 1 && c.se_usa_en_app === 1)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

/** Lo que el vendedor lleva capturado, tal cual (los textos sin recortar). */
export interface EntradaGasto {
  /** El campo elegido, leido por id (activo o no: ver `gastos.registrar`). */
  campo: Pick<CampoEgreso, 'id'> | null;
  monto: string;
  comentario: string;
  fotoUri: string | null;
  /** La jornada de hoy ya esta cerrada (`estadoMenuJornada`). */
  diaCerrado: boolean;
}

export interface ValidacionGasto {
  /** Lo que falta, en el orden de la pantalla. Vacio = se puede guardar. */
  faltantes: string[];
  /** El monto ya convertido, o `null` si no se entiende. */
  montoCentavos: number | null;
  /** Listo para `gastos.registrar` (sin vendedor), o `null` si falta algo. */
  gasto: Omit<DatosRegistroGasto, 'vendedorId'> | null;
}

/** La validacion entera del gasto. Pura: misma entrada, misma salida. */
export function validarGasto(e: EntradaGasto): ValidacionGasto {
  const faltantes: string[] = [];
  const montoCentavos = montoACentavos(e.monto);
  const comentario = e.comentario.trim() === '' ? null : e.comentario.trim();

  if (e.campo === null) faltantes.push('Elige el campo del gasto.');
  if (e.monto.trim() === '') faltantes.push('Escribe el monto en pesos.');
  else if (montoCentavos === null) {
    faltantes.push('El monto tiene que ser mayor que $0, con dos decimales a lo más.');
  }
  if (comentario !== null && comentario.length > LARGO_MAX_COMENTARIO_GASTO) {
    faltantes.push(`Las observaciones no pueden pasar de ${LARGO_MAX_COMENTARIO_GASTO} caracteres.`);
  }
  if (e.diaCerrado) faltantes.push('El día ya está cerrado: no se pueden registrar gastos.');

  return {
    faltantes,
    montoCentavos,
    gasto:
      faltantes.length === 0 && e.campo !== null && montoCentavos !== null
        ? { campoEgresoId: e.campo.id, montoCentavos, comentario, fotoUri: e.fotoUri }
        : null,
  };
}

/**
 * Lo que falta solo se lista cuando el vendedor ya empezo a capturar (campo,
 * monto u observaciones): al abrir el formulario vacio no se le regaña.
 */
export function faltantesVisiblesGasto(e: EntradaGasto, v: ValidacionGasto): string[] {
  const empezo = e.campo !== null || e.monto !== '' || e.comentario !== '';
  return empezo ? v.faltantes : [];
}

/**
 * Si "Gastos" deja abrir el formulario: hace falta al menos un campo con "Se usa
 * en la app" y el dia abierto (con el dia cerrado la entrada del menu tambien
 * queda deshabilitada, `estadoMenuJornada`).
 */
export function puedeRegistrarGasto(e: { camposDisponibles: number; diaCerrado: boolean }): boolean {
  return e.camposDisponibles > 0 && !e.diaCerrado;
}

/** La pastilla de UN gasto en "Gastos de hoy". */
export function pastillaGasto(
  g: Pick<Gasto, 'sync_estado' | 'sync_error'>,
): { texto: string; estado: EstadoPastilla; detalle: string | null } {
  switch (g.sync_estado) {
    case 'pendiente':
    case 'enviando':
      return { texto: 'por subir', estado: 'pendiente', detalle: null };
    case 'sincronizado':
      return { texto: 'subido', estado: 'listo', detalle: null };
    case 'error':
      return { texto: 'rechazado', estado: 'error', detalle: motivoDeRechazo(g.sync_error) };
  }
}
