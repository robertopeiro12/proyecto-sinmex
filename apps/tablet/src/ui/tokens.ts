/**
 * Tokens del sistema de diseno de la [[App Tablet]]: "instrumento de campo".
 *
 * ## Por que no parece una app de oficina
 *
 * El vendedor no usa esto sentado. Lo usa **al sol de Tijuana**, entrando y
 * saliendo de una camioneta, con las manos ocupadas, y sustituye una **nota de
 * papel** que el cliente firma. Cada token de aqui sale de esa escena, no del
 * gusto de nadie:
 *
 * - **Contraste brutal.** La paleta anterior (gris azulado `#5A6779` sobre
 *   `#F5F7FA`) daba ~4.5:1 — correcto bajo techo, ilegible al sol directo.
 *   Aqui la tinta sobre el papel da **~15:1**.
 * - **Papel calido, no gris de dashboard.** Sustituye un formato impreso; que
 *   lo parezca ayuda a que el vendedor lo lea como lo que es.
 * - **Naranja de senal, no azul corporativo.** Es el color del equipo de alta
 *   visibilidad de campo, y de paso es la familia cromatica del producto
 *   (jamaica, tamarindo). El azul generico no dice nada aqui.
 * - **Sin sombras suaves.** Al sol no se ven, y `elevation` de Android se
 *   comporta distinto entre fabricantes. La jerarquia la dan **bordes y peso**.
 *
 * ## Contraste verificado (WCAG 2.1, sobre `papel`)
 *
 * | Par | Ratio | Uso |
 * |---|---|---|
 * | `tinta` / `papel` | ~15.3:1 | texto principal |
 * | `tintaSuave` / `papel` | ~6.4:1 | texto secundario (AA normal) |
 * | `primarioTinta` / `primario` | ~7.1:1 | texto sobre boton de accion |
 *
 * > [!warning] No agregues un color sin medir
 * > Si hace falta un color nuevo, calcula el ratio contra `papel` **y** contra
 * > `superficie` antes de meterlo. Un token que solo se ve bien en el
 * > escritorio del que lo eligio es un token roto.
 */

/**
 * Paleta. Nombres por **rol**, nunca por color: el dia que el naranja cambie,
 * cambia aqui y no en 15 pantallas. Prohibido escribir un hex en una pantalla.
 */
export const colores = {
  /** Fondo de la app. Papel calido. */
  papel: '#F2EDE3',
  /** Superficie elevada (tarjetas, campos). Papel mas claro. */
  superficie: '#FBF8F2',
  /** Superficie hundida (cabeceras de tabla, estados inertes). */
  superficieHundida: '#E7E0D2',

  /** Texto principal. Casi negro, calido. */
  tinta: '#191410',
  /** Texto secundario, etiquetas, ayudas. */
  tintaSuave: '#5C5147',
  /** Texto sobre superficies oscuras. */
  tintaInversa: '#FBF8F2',

  /** Linea fina entre elementos. */
  borde: '#CFC5B4',
  /** Borde de enfasis: lo que el dedo va a tocar o lo que exige atencion. */
  bordeFuerte: '#191410',

  /** Accion principal. Naranja de senal. */
  primario: '#A8380A',
  primarioTinta: '#FFFFFF',
  /** Fondo tenue del primario, para avisos y estados seleccionados. */
  primarioTenue: '#F7E4D8',

  /** Destructivo / irreversible. Rojo jamaica. */
  peligro: '#8C1A16',
  peligroTinta: '#FFFFFF',
  peligroTenue: '#F7DEDC',

  /** Confirmado, cuadrado, sincronizado. */
  exito: '#1D5B3A',
  exitoTenue: '#DCEBE2',

  /** Pendiente, sin red, requiere atencion pero no es error. */
  aviso: '#8A5A00',
  avisoTenue: '#F6E9CE',
} as const;

/**
 * Escala de espacio, base 4.
 *
 * Se usa **siempre** desde aqui. Un `marginTop: 13` suelto es una grieta por
 * donde se va la consistencia.
 */
export const espacio = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/** Radios. Discretos: esto es un instrumento, no una app de consumo. */
export const radio = {
  /** Campos, botones. */
  chico: 6,
  /** Tarjetas. */
  medio: 10,
  /** Pastillas de estado. */
  pastilla: 999,
} as const;

/** Grosores de borde. `fuerte` marca lo tocable; `hairline` solo separa. */
export const grosor = {
  hairline: 1,
  fuerte: 2,
  /** Barra lateral que codifica estado en una tarjeta. */
  acento: 4,
} as const;

/**
 * Familias tipograficas.
 *
 * - **Condensada** para titulos: cabe mas en el ancho de un telefono sin
 *   encoger la letra, que es justo el problema de una app disenada para tablet
 *   y abierta en un celular.
 * - **Barlow** para texto: grotesca de baja modulacion, disenada para
 *   senalizacion; aguanta mal angulo y movimiento.
 * - **Mono para cifras.** No es decorativo: dinero, folios, kilometraje y
 *   cantidades tienen que **alinear en columna** y no confundirse entre si.
 *   Ver el componente `Cifra`.
 *
 * Los valores son los nombres que registra `expo-font` en `tipografia.ts`.
 * Si las fuentes aun no cargaron, `undefined` deja el tipo del sistema y la
 * app **igual se pinta** — ver el comentario de `useTipografias()`.
 */
export const fuente = {
  titulo: 'BarlowCondensed_700Bold',
  tituloMedio: 'BarlowCondensed_600SemiBold',
  cuerpo: 'Barlow_400Regular',
  cuerpoMedio: 'Barlow_500Medium',
  cuerpoFuerte: 'Barlow_600SemiBold',
  cifra: 'IBMPlexMono_500Medium',
  cifraFuerte: 'IBMPlexMono_600SemiBold',
} as const;

/**
 * Escala tipografica en puntos, **antes** de escalar por dispositivo.
 *
 * `responsivo.ts` la multiplica: la misma jerarquia se mantiene en un telefono
 * de 5" y en una tablet de 10", en vez de tener dos escalas que se desincronizan.
 */
export const tipo = {
  /** Numeros que el vendedor lee de un vistazo: totales, kilometraje. */
  cifraGrande: 34,
  titulo: 30,
  subtitulo: 22,
  /** Texto de tarjeta, opciones de menu. */
  destacado: 19,
  cuerpo: 16,
  /** Etiquetas en versalitas, ayudas. */
  menor: 13,
} as const;

/**
 * Altura minima de un objetivo tactil, por dispositivo.
 *
 * > [!important] En telefono son MAS grandes, no mas chicos
 * > Parece al reves y no lo es. La tablet va apoyada o montada y se toca con
 * > las dos manos; el telefono se usa **con el pulgar, de pie y en
 * > movimiento**, que es la condicion mas dificil. El objetivo crece cuando la
 * > pantalla se encoge.
 */
export const tactil = {
  compacto: 64,
  medio: 56,
  amplio: 56,
} as const;
