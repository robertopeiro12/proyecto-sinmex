import { espacio, tactil } from './tokens';

/**
 * Adaptacion a telefono y tablet.
 *
 * T-04 se escribio para **tablet en horizontal** y nada mas: `app.json` fijaba
 * `orientation: landscape` y los tamanos estaban cableados a ese caso. En un
 * telefono la app era inusable. Aqui vive la regla unica que decide como se ve
 * cada tamano de pantalla.
 *
 * > [!important] Se mide el ANCHO de la ventana, no el dispositivo
 * > No se pregunta "es tablet?" — se pregunta "cuanto ancho tengo". Asi el
 * > mismo codigo cubre el telefono girado, la tablet en vertical, la pantalla
 * > partida de Android y cualquier equipo que compren despues. Preguntar por el
 * > modelo es como se acumulan casos especiales que nadie puede probar.
 */

/**
 * Los tres tamanos. Los cortes salen de la realidad del parque de dispositivos,
 * no de una libreria de CSS:
 *
 * - **compacto** (<600dp): telefono en vertical. Una columna, pulgar.
 * - **medio** (600-899dp): tablet chica, o telefono en horizontal. Dos columnas.
 * - **amplio** (>=900dp): tablet en horizontal — el caso para el que se diseno
 *   la app y el que usaran los vendedores. Tres columnas.
 */
export type Tamano = 'compacto' | 'medio' | 'amplio';

export interface Dispositivo {
  tamano: Tamano;
  /** Ancho de la ventana en dp, tal cual. Para casos que necesiten el numero. */
  ancho: number;
  /** `true` cuando el alto supera al ancho. */
  vertical: boolean;
  /** Columnas de la rejilla de menu. */
  columnas: number;
  /** Margen exterior de la pantalla. */
  margen: number;
  /** Separacion entre tarjetas de la rejilla. */
  hueco: number;
  /**
   * Alto minimo de cualquier cosa tocable. Mas grande en telefono — ver la
   * nota de `tactil` en `tokens.ts`.
   */
  tactil: number;
  /**
   * Multiplicador de la escala tipografica. La tablet gana un poco de tamano
   * porque se mira desde mas lejos (apoyada en el tablero, no en la mano).
   */
  escalaTipo: number;
  /**
   * Ancho maximo de una columna de lectura. `null` = usar todo el ancho.
   *
   * En una tablet de 10" en horizontal, un formulario a 1200dp de ancho obliga
   * a barrer la cabeza de lado a lado para leer una linea. Se acota.
   */
  anchoLectura: number | null;
}

/** Corte entre compacto y medio, en dp. */
export const CORTE_MEDIO = 600;
/** Corte entre medio y amplio, en dp. */
export const CORTE_AMPLIO = 900;

/**
 * Resuelve todo lo que depende del tamano de pantalla.
 *
 * **Funcion pura a proposito**: recibe numeros y devuelve numeros, sin tocar
 * React ni React Native. Es lo unico de la capa visual que se puede probar sin
 * un dispositivo, y en este proyecto no hay ninguno en el CI — ver
 * `responsivo.spec.ts`.
 */
export function resolverDispositivo(ancho: number, alto: number): Dispositivo {
  const tamano: Tamano =
    ancho >= CORTE_AMPLIO ? 'amplio' : ancho >= CORTE_MEDIO ? 'medio' : 'compacto';

  const porTamano = {
    compacto: {
      columnas: 1,
      margen: espacio.md,
      hueco: espacio.sm,
      tactil: tactil.compacto,
      escalaTipo: 1,
      anchoLectura: null,
    },
    medio: {
      columnas: 2,
      margen: espacio.lg,
      hueco: espacio.md,
      tactil: tactil.medio,
      escalaTipo: 1.05,
      anchoLectura: 720,
    },
    amplio: {
      columnas: 3,
      margen: espacio.xl,
      hueco: espacio.md,
      tactil: tactil.amplio,
      escalaTipo: 1.1,
      anchoLectura: 900,
    },
  } as const;

  return { tamano, ancho, vertical: alto > ancho, ...porTamano[tamano] };
}

/**
 * Escala un tamano de `tipo` para el dispositivo y lo redondea.
 *
 * Se redondea porque las medias unidades de fuente en Android producen saltos
 * de linea distintos entre equipos, y una etiqueta que cabe en una tablet y se
 * parte en otra es un reporte de bug que nadie sabe reproducir.
 */
export function escalarTipo(base: number, escala: number): number {
  return Math.round(base * escala);
}

/*
 * El hook `useDispositivo()` NO vive aqui, vive en `usar-dispositivo.ts`.
 *
 * Este archivo no importa `react-native` a proposito: asi Jest lo corre en
 * Node sin transformar nada, que es lo que permite probar los cortes, la
 * escala y la regla del objetivo tactil sin un dispositivo. Es la misma
 * doctrina que el resto del proyecto — la logica se separa de la plataforma
 * para poder verificarla. Si metes un import de RN aqui, se caen las pruebas.
 */
