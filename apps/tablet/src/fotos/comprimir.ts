/**
 * Comprimir la foto del prospecto **en el equipo**, antes de guardarla (T-40).
 *
 * > [!info] Por que se comprime aqui y no al subir
 * > El cliente pidio la foto *"si esto no se hace lento"*. La foto se toma en la
 * > calle, sin red, y viaja despues por la WiFi del negocio: el minuto que se
 * > ahorra comprimiendo son bytes que no se mandan cuando por fin hay red, y
 * > segundos que el vendedor no pasa parado enfrente del local.
 *
 * ## El objetivo es un numero, no una receta
 *
 * {@link OBJETIVO_BYTES} son 300 kB. Redimensionar a ~1600 px y bajar la calidad
 * es el **camino**, no la meta: el peso de un JPEG depende de la foto (una pared
 * lisa y un estante lleno de botellas al mismo tamano y calidad se llevan un
 * factor de cuatro), asi que una calidad fija no puede garantizar nada. Por eso
 * este modulo **mide lo que produce** y sigue bajando hasta llegar al numero.
 *
 * ## El tope de 2 MB es distinto del objetivo, y es duro
 *
 * El servidor responde **413 permanente** a una foto de mas de 2 MB. Una foto que
 * se guardara por encima de ese tope tendria garantizado el rechazo: se
 * intentaria subir, fallaria, se descartaria, y el vendedor habria tomado una
 * foto para nada. De ahi que si ni el ultimo intento baja de
 * {@link TOPE_SERVIDOR_BYTES}, esto **lanza** en vez de devolver una ruta: el
 * alta sigue adelante sin foto, que es un prospecto perfectamente valido.
 *
 * Todo lo de aqui es probable en Node: el redimensionado y el guardado entran por
 * {@link Manipulador}, que en la tablet es `expo-image-manipulator` y en las
 * pruebas es una funcion que devuelve tamanos.
 */

/** Meta: 300 kB. Ver el bloque de arriba — es un numero medido, no una receta. */
export const OBJETIVO_BYTES = 300 * 1024;

/**
 * Tope del servidor: 2 MB. Pasarse es un **413 permanente**.
 *
 * Duplicado a proposito respecto a `TAMANO_MAX_FOTO_BYTES` del backend, por la
 * misma razon que el contrato de sincronizacion se duplica: la tablet no puede
 * importar de NestJS (Metro). Si el backend lo cambia, esto se cambia tambien.
 */
export const TOPE_SERVIDOR_BYTES = 2 * 1024 * 1024;

/**
 * Los intentos, en orden. **Los numeros estan medidos, no elegidos.**
 *
 * Primero se baja la **calidad** a 1600 px, porque a esa resolucion los
 * artefactos del JPEG casi no se ven en una foto de una fachada y el ahorro es
 * grande. Solo cuando la calidad ya no alcanza se baja la **resolucion**, que es
 * lo que de verdad quita detalle — y lo que el administrador necesita del lugar
 * es reconocerlo, no leer la letra chica.
 *
 * ## Por que empieza en 0.5 y no en 0.7
 *
 * Medido el 2026-09-18 sobre tres fotos de 4032x3024 (~4.1-4.4 MB, el tamano de
 * un archivo de camara de 12 MP), redimensionadas a 1600 px:
 *
 * | Calidad | Foto lisa | Foto normal | Foto con mucho detalle | ¿≤300 kB? |
 * |---|---|---|---|---|
 * | 0.70 | 432 kB | 445 kB | 525 kB | **ninguna** |
 * | 0.60 | 325 kB | 346 kB | 415 kB | ninguna |
 * | 0.50 | 247 kB | 274 kB | 331 kB | dos de tres |
 * | 0.40 | 183 kB | 211 kB | 256 kB | **todas** |
 * | 0.35 | 153 kB | 181 kB | 221 kB | todas |
 *
 * Es decir: **0.7 no baja de 300 kB en ninguna foto real de 12 MP**, asi que
 * ponerlo de primer intento seria una codificacion regalada en cada captura, con
 * el vendedor esperando. 0.5 es la mejor calidad que de verdad tiene
 * posibilidades de acertar de primeras, y 0.4 es la que acierta siempre.
 *
 * Y fijense en la columna: la misma calidad y el mismo tamano dan 247 kB o 331 kB
 * segun la foto — un factor de 1.4. Por eso ninguna calidad fija puede garantizar
 * el numero, y por eso este modulo **mide**.
 *
 * El primer intento que baje de {@link OBJETIVO_BYTES} gana; no se sigue
 * buscando algo mas pequeno.
 */
export const INTENTOS: readonly { ladoMayor: number; calidad: number }[] = [
  { ladoMayor: 1600, calidad: 0.5 },
  { ladoMayor: 1600, calidad: 0.4 },
  { ladoMayor: 1600, calidad: 0.3 },
  { ladoMayor: 1200, calidad: 0.4 },
  { ladoMayor: 1200, calidad: 0.3 },
  { ladoMayor: 900, calidad: 0.35 },
  { ladoMayor: 700, calidad: 0.3 },
];

/** La foto tal como salio de la camara. */
export interface FotoOriginal {
  uri: string;
  ancho: number;
  alto: number;
}

/** Un guardado concreto que se le pide al manipulador. */
export interface PeticionGuardado {
  uri: string;
  /**
   * Px del lado mayor. El otro lado lo calcula el manipulador para conservar la
   * proporcion.
   */
  ladoMayor: number;
  /**
   * `true` si la foto es mas alta que ancha, es decir si el lado mayor es el
   * **alto**.
   *
   * Hace falta porque `expo-image-manipulator` redimensiona por `width` o por
   * `height`, no por "el lado mayor". Pedirle siempre `width: 1600` a una foto
   * vertical le dejaria 2133 px de alto — mas grande que la horizontal que se
   * queria limitar.
   */
  vertical: boolean;
  /** De 0 a 1. */
  calidad: number;
}

/** Lo que devuelve un guardado: donde quedo y **cuanto pesa de verdad**. */
export interface Guardado {
  uri: string;
  bytes: number;
}

/**
 * Lo unico nativo de la compresion.
 *
 * En la tablet lo implementa `expo-image-manipulator` + `expo-file-system` (ver
 * `expo.ts`); en las pruebas, una funcion. Los bytes los tiene que devolver
 * **medidos del archivo**, no estimados: el bucle de arriba depende de eso.
 */
export interface Manipulador {
  guardar(peticion: PeticionGuardado): Promise<Guardado>;
}

export interface FotoComprimida extends Guardado {
  ladoMayor: number;
  calidad: number;
  /** Cuantos guardados hicieron falta. Util para el log y para las pruebas. */
  intentos: number;
  /**
   * `false` si se quedo entre {@link OBJETIVO_BYTES} y
   * {@link TOPE_SERVIDOR_BYTES}.
   *
   * No es un fallo: el servidor la acepta y vale mas una foto de 400 kB que
   * ninguna. Se reporta para que quede en el log de la app, que es donde se
   * descubre que los intentos hay que reajustarlos.
   */
  objetivoAlcanzado: boolean;
}

/** La foto no se pudo dejar por debajo del tope del servidor. */
export class ErrorCompresion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCompresion';
  }
}

/**
 * Comprime hasta bajar de {@link OBJETIVO_BYTES}, midiendo cada intento.
 *
 * @throws {ErrorCompresion} si ni el ultimo intento baja de
 *   {@link TOPE_SERVIDOR_BYTES}. Quien llama guarda el prospecto **sin foto**.
 */
export async function comprimirParaSubir(
  original: FotoOriginal,
  manipulador: Manipulador,
): Promise<FotoComprimida> {
  const ladoOriginal = Math.max(original.ancho, original.alto);
  const vertical = original.alto > original.ancho;

  let mejor: (Guardado & { ladoMayor: number; calidad: number }) | null = null;
  let intentos = 0;

  for (const intento of INTENTOS) {
    // Nunca agrandar: `resize` a 1600 px de una foto de 800 la interpolaria a
    // 1600, que pesa mas y no anade ni un detalle. Con una camara de tablet no
    // deberia pasar, pero una foto que venga de otra parte si.
    const ladoMayor = Math.min(intento.ladoMayor, ladoOriginal);

    const guardado = await manipulador.guardar({
      uri: original.uri,
      ladoMayor,
      vertical,
      calidad: intento.calidad,
    });
    intentos += 1;

    if (mejor === null || guardado.bytes < mejor.bytes) {
      mejor = { ...guardado, ladoMayor, calidad: intento.calidad };
    }

    if (guardado.bytes <= OBJETIVO_BYTES) {
      return { ...mejor, intentos, objetivoAlcanzado: true };
    }
  }

  if (mejor === null) {
    // Solo si INTENTOS quedara vacio: es un bug de configuracion, no de campo.
    throw new ErrorCompresion('No hay ningun intento de compresion configurado.');
  }

  if (mejor.bytes > TOPE_SERVIDOR_BYTES) {
    throw new ErrorCompresion(
      `La foto sigue pesando ${mejor.bytes} bytes despues de ${intentos} intentos y el servidor no acepta mas de ${TOPE_SERVIDOR_BYTES}.`,
    );
  }

  // Entre el objetivo y el tope: se acepta. El servidor la toma, y una foto de
  // 400 kB vale mas que ninguna.
  return { ...mejor, intentos, objetivoAlcanzado: false };
}
