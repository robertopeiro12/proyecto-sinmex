/**
 * Reglas puras de la foto del prospecto (T-40): tamano, formato y nombre.
 *
 * Sin base de datos y sin disco, por lo mismo que `datos-prospecto.ts`: son las
 * decisiones que hay que poder probar de una en una, sin levantar nada.
 *
 * Viven en `cartera-clientes/` y no en `sincronizacion/` porque la duena de
 * `cliente` —y por tanto de su foto— es Cartera de Clientes (ADR-0009). El
 * controller de la subida esta en `sincronizacion/` solo porque la **clave** de
 * la URL es del buzon del push.
 */

/**
 * Tope de la subida: 2 MB.
 *
 * La tablet comprime a ~300 KB antes de guardar, asi que 2 MB son casi siete
 * veces el tamano esperado. La holgura es a proposito: el tope **no** es una
 * regla de negocio, es el freno a una foto que llego mal (una camara que ignoro
 * la compresion, un archivo que no era lo que decia ser). Si un dia rechaza
 * fotos de verdad, el bug esta en la compresion del equipo, no aqui.
 *
 * Y es un tope en BYTES leidos, no en `content-length`: la cabecera la escribe
 * el cliente y puede mentir. Ver `leerCuerpoLimitado`.
 */
export const TAMANO_MAX_FOTO_BYTES = 2 * 1024 * 1024;

/**
 * La clave que puede nombrar un archivo.
 *
 * `clave_idempotencia` es `text` en Postgres y la escribe **la tablet**: nada en
 * la base impide un valor como `../../etc/passwd`. Como el nombre del archivo
 * sale de la clave, esto es lo que separa "escribo en FOTOS_DIR" de "escribo
 * donde me digan". Se comprueba **aunque** el controller ya use `ParseUUIDPipe`:
 * una segunda barrera aqui es la que sigue en pie el dia que alguien llame a
 * esto desde otro sitio.
 *
 * El formato es el del uuid v4 que la tablet genera al grabar la fila
 * (`expo-crypto.randomUUID`, ver `apps/tablet/src/datos/tipos.ts`) — el mismo
 * valor que viaja como `clave` en el push.
 */
const RE_CLAVE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function claveNombrable(clave: string): boolean {
  return RE_CLAVE.test(clave);
}

/**
 * `<clave>.jpg`.
 *
 * > [!info] La idempotencia es esto, no codigo que haya que mantener
 * > La clave de la URL es la misma llave de idempotencia que identifica la
 * > operacion del prospecto, asi que **reenviar escribe el mismo nombre**. No
 * > hace falta un contador, ni un identificador nuevo, ni una tabla de control:
 * > no hay duplicados posibles porque no hay dos nombres posibles.
 *
 * Lanza si la clave no es nombrable en vez de sanearla: "saneado" significaria
 * que dos claves distintas pueden acabar en el mismo archivo, y eso es
 * exactamente el duplicado silencioso que la propiedad de arriba evita.
 */
export function nombreArchivoFoto(clave: string): string {
  if (!claveNombrable(clave)) {
    throw new Error(
      `clave no utilizable como nombre de archivo: ${JSON.stringify(clave)}`,
    );
  }
  return `${clave}.jpg`;
}

/**
 * ¿El contenido **es** JPEG?
 *
 * Se mira el contenido y no el `Content-Type`, que lo pone quien sube y no
 * prueba nada. Sin esto, cualquier cosa (un PNG, un HTML, un video recortado)
 * quedaria guardada como `.jpg` y el portal mostraria una imagen rota meses
 * despues, sin ninguna pista de donde vino.
 *
 * Dos senales, las dos baratas:
 *
 * - **SOI** `FF D8 FF` al principio. Es la firma de JPEG; el tercer byte
 *   (inicio del primer marcador) descarta un archivo que solo empieza con
 *   `FF D8` por casualidad.
 * - **EOI** `FF D9` al final. Esto no es formato, es **integridad**: una subida
 *   cortada a medias (la WiFi del negocio se fue) empieza bien y no acaba. Se
 *   saltan los ceros de cola porque hay camaras que rellenan el archivo.
 *
 * `FF D9` tambien aparece dentro de la miniatura EXIF de muchas fotos, asi que
 * esto no detecta *cualquier* truncamiento — detecta el caso comun y no produce
 * falsos rechazos, que es el reparto que importa: rechazar una foto buena es
 * peor, porque la tablet la reintentaria para siempre.
 */
export function esJpeg(cuerpo: Buffer): boolean {
  if (cuerpo.length < 4) return false;
  if (cuerpo[0] !== 0xff || cuerpo[1] !== 0xd8 || cuerpo[2] !== 0xff) {
    return false;
  }

  let fin = cuerpo.length - 1;
  while (fin > 1 && cuerpo[fin] === 0x00) fin -= 1;

  return cuerpo[fin - 1] === 0xff && cuerpo[fin] === 0xd9;
}
