import { StyleSheet } from 'react-native';

import { escalarTipo, type Dispositivo, type Tamano } from './responsivo';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';
import { useDispositivo } from './usar-dispositivo';

export { colores, espacio, fuente, grosor, radio, tipo } from './tokens';
export type { Dispositivo, Tamano } from './responsivo';

/**
 * Estilos comunes, construidos **para el tamano de pantalla actual**.
 *
 * La version de T-04 era un `StyleSheet.create` estatico con medidas cableadas
 * a tablet en horizontal. Como los tamanos ahora dependen del dispositivo, la
 * hoja se construye por tamano y se **cachea**: hay como mucho tres en toda la
 * vida del proceso, y girar el equipo reusa la que ya existe en vez de crear
 * objetos en cada render.
 */
function construirEstilos(d: Dispositivo) {
  const t = (base: number) => escalarTipo(base, d.escalaTipo);

  return StyleSheet.create({
    /** Raiz de una pantalla con scroll. */
    pantalla: {
      flex: 1,
      backgroundColor: colores.papel,
    },
    /** Contenido de la pantalla: margen y columna de lectura acotada. */
    contenido: {
      padding: d.margen,
      paddingBottom: espacio.xxl,
      ...(d.anchoLectura ? { maxWidth: d.anchoLectura, width: '100%' as const } : {}),
    },
    /** Como `contenido`, pero centrado. Para formularios (login, abrir dia). */
    contenidoCentrado: {
      padding: d.margen,
      paddingBottom: espacio.xxl,
      width: '100%',
      ...(d.anchoLectura ? { maxWidth: d.anchoLectura, alignSelf: 'center' as const } : {}),
    },

    titulo: {
      fontFamily: fuente.titulo,
      fontSize: t(tipo.titulo),
      lineHeight: t(tipo.titulo) * 1.1,
      color: colores.tinta,
      letterSpacing: 0.2,
      marginBottom: espacio.xs,
    },
    subtitulo: {
      fontFamily: fuente.cuerpo,
      fontSize: t(tipo.cuerpo),
      lineHeight: t(tipo.cuerpo) * 1.4,
      color: colores.tintaSuave,
      marginBottom: espacio.lg,
    },
    seccion: {
      fontFamily: fuente.tituloMedio,
      fontSize: t(tipo.subtitulo),
      color: colores.tinta,
      marginTop: espacio.lg,
      marginBottom: espacio.sm,
    },

    /**
     * Etiqueta de campo. Versalitas con tracking abierto: a este tamano, las
     * mayusculas apretadas se leen como un bloque y no como palabras.
     */
    etiqueta: {
      fontFamily: fuente.cuerpoFuerte,
      fontSize: t(tipo.menor),
      color: colores.tintaSuave,
      textTransform: 'uppercase',
      letterSpacing: 1.1,
      marginBottom: espacio.xs,
    },
    textoTarjeta: {
      fontFamily: fuente.cuerpoFuerte,
      fontSize: t(tipo.destacado),
      color: colores.tinta,
    },
    textoSuave: {
      fontFamily: fuente.cuerpo,
      fontSize: t(tipo.cuerpo),
      lineHeight: t(tipo.cuerpo) * 1.4,
      color: colores.tintaSuave,
      marginTop: espacio.xs,
    },

    tarjeta: {
      backgroundColor: colores.superficie,
      borderRadius: radio.medio,
      borderWidth: grosor.hairline,
      borderColor: colores.borde,
      padding: espacio.md,
      marginBottom: espacio.md,
    },

    /**
     * Rejilla del menu. `columnas` sale del dispositivo, asi que el telefono
     * apila y la tablet reparte, con el mismo marcado.
     */
    rejilla: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: d.hueco,
      marginBottom: espacio.md,
    },
    celdaRejilla: {
      flexGrow: 1,
      // -1% de holgura: sin ella, el redondeo de dp parte la ultima columna.
      flexBasis: `${100 / d.columnas - 1}%`,
      minHeight: Math.max(d.tactil + espacio.lg, 96),
      justifyContent: 'center',
      marginBottom: 0,
    },

    campo: {
      fontFamily: fuente.cuerpo,
      borderWidth: grosor.fuerte,
      borderColor: colores.borde,
      borderRadius: radio.chico,
      backgroundColor: colores.superficie,
      paddingHorizontal: espacio.md,
      paddingVertical: espacio.sm,
      fontSize: t(tipo.subtitulo),
      color: colores.tinta,
      minHeight: d.tactil,
      marginBottom: espacio.md,
    },
    /** Campo que espera un numero: cifras monoespaciadas. */
    campoCifra: {
      fontFamily: fuente.cifra,
      letterSpacing: 0.5,
    },
    campoEnfocado: {
      borderColor: colores.primario,
    },
    campoInvalido: {
      borderColor: colores.peligro,
    },

    error: {
      fontFamily: fuente.cuerpoMedio,
      color: colores.peligro,
      fontSize: t(tipo.cuerpo),
      marginTop: espacio.sm,
      marginBottom: espacio.sm,
    },

    /** Fila de botones: se apila en telefono, se reparte en tablet. */
    filaAcciones: {
      flexDirection: d.tamano === 'compacto' ? 'column' : 'row',
      gap: espacio.sm,
      marginTop: espacio.md,
    },
  });
}

const cache = new Map<Tamano, ReturnType<typeof construirEstilos>>();

export interface Tema {
  dispositivo: Dispositivo;
  estilos: ReturnType<typeof construirEstilos>;
  /** Escala un tamano de `tipo` al dispositivo actual. */
  t: (base: number) => number;
}

/**
 * Punto de entrada del sistema de diseno. Toda pantalla empieza con esto.
 *
 * ```tsx
 * const { estilos, dispositivo } = useTema();
 * ```
 *
 * > [!warning] No escribas medidas ni colores sueltos en una pantalla
 * > Si necesitas algo que no esta aqui, agregalo aqui. Un `fontSize: 17` o un
 * > `'#0B6BCB'` en una pantalla es como la app vuelve a verse como quince apps
 * > distintas — y como se pierde el contraste que hace falta al sol.
 */
export function useTema(): Tema {
  const dispositivo = useDispositivo();

  let estilos = cache.get(dispositivo.tamano);
  if (!estilos) {
    estilos = construirEstilos(dispositivo);
    cache.set(dispositivo.tamano, estilos);
  }

  return {
    dispositivo,
    estilos,
    t: (base: number) => escalarTipo(base, dispositivo.escalaTipo),
  };
}
