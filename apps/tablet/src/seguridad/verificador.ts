/**
 * Verificador local de la contrasena del vendedor.
 *
 * Es la pieza que permite **re-autenticar sin red**: tras un login en linea
 * correcto, la app deriva la contrasena que el vendedor acaba de teclear y
 * guarda solo el resultado. Cuando la tablet se reinicia o se bloquea en ruta,
 * la contrasena se comprueba contra ese verificador, sin servidor.
 *
 * > [!important] El servidor nunca envia material de hash
 * > El verificador lo produce la propia app con la contrasena que ya tiene en
 * > la mano durante el login en linea. El backend no manda su hash argon2id ni
 * > ningun derivado: si lo hiciera, el hash del servidor viajaria por la red y
 * > quedaria en el dispositivo, ampliando la superficie de ataque sin ganar
 * > nada. Ademas asi el backend no necesita conocer el KDF de la app.
 *
 * Formato guardado (texto, va a `expo-secure-store`):
 *
 *     pbkdf2-sha256$<iteraciones>$<sal hex>$<clave derivada hex>
 *
 * Las iteraciones viajan **dentro** del verificador para que subir el coste no
 * invalide los verificadores ya emitidos: cada uno se comprueba con el coste
 * con el que nacio, y el siguiente login en linea lo regenera con el nuevo.
 *
 * El modelo de amenaza que se acepta esta en
 * `30-Decisiones/ADR-0005 Sesion del vendedor valida offline` del vault.
 */
import { bytesDeHex, bytesDeTexto, hexDeBytes, igualesEnTiempoConstante } from './bytes';
import { pbkdf2Sha256 } from './pbkdf2';

const ETIQUETA = 'pbkdf2-sha256';

/**
 * Coste del KDF local **por defecto**.
 *
 * La recomendacion de OWASP para PBKDF2-HMAC-SHA256 son 600 000 iteraciones, y
 * aqui hay 60 000. La diferencia no es un descuido, es el limite del motor:
 * medido en `pbkdf2.spec.ts`, 150 000 iteraciones cuestan ~1 s en Node sobre un
 * Mac. Hermes (el motor de React Native) **interpreta, no compila JIT**, asi
 * que en una tablet Android de gama baja el mismo trabajo puede costar entre 5
 * y 15 veces mas. Con la cifra de OWASP el vendedor esperaria decenas de
 * segundos para entrar a su app cada manana; con esta, unos pocos segundos en
 * el peor caso.
 *
 * Que se hace en vez de subir el numero a ciegas:
 *
 * 1. **El coste real lo manda el servidor** en la respuesta del login
 *    (`politica.costeVerificador`, variable `VERIFICADOR_LOCAL_ITERACIONES`).
 *    Cuando haya una tablet de verdad se mide y se ajusta sin publicar un APK
 *    nuevo. Esta constante es solo el respaldo si el servidor no lo dice.
 * 2. El verificador guarda **sus** iteraciones (ver arriba), asi que subir el
 *    coste no invalida las sesiones ya emitidas.
 * 3. El verificador no vive a la intemperie: esta en `expo-secure-store`
 *    (Keystore de Android). El KDF es la segunda linea, no la unica.
 *
 * > [!warning] Sin medir en tablet
 * > La medicion de `pbkdf2.spec.ts` es en Node. **El costo en el dispositivo
 * > esta sin medir**: es lo primero que hay que comprobar cuando haya una
 * > tablet. Si el login tarda mas de ~2 s, bajar
 * > `VERIFICADOR_LOCAL_ITERACIONES` en el backend.
 */
export const COSTE_PBKDF2 = 60_000;

/** 16 bytes de sal, la recomendacion de RFC 8018 y de OWASP. */
export const SAL_BYTES = 16;

/** 32 bytes de clave derivada: la salida natural de SHA-256. */
export const DERIVADA_BYTES = 32;

/**
 * Fuente de aleatoriedad **criptografica**. Se inyecta para que las pruebas
 * puedan fijarla; en la app es `getRandomBytes` de `expo-crypto`.
 *
 * Nunca sustituir por `Math.random()`: una sal predecible permite precalcular
 * tablas contra todos los vendedores a la vez.
 */
export type FuenteAleatoria = (bytes: number) => Uint8Array;

/** Deriva el verificador de una contrasena recien tecleada. */
export function derivarVerificador(
  password: string,
  aleatorio: FuenteAleatoria,
  iteraciones: number = COSTE_PBKDF2,
): string {
  const sal = aleatorio(SAL_BYTES);
  if (sal.length !== SAL_BYTES) {
    throw new Error(`La fuente aleatoria devolvio ${sal.length} bytes, se esperaban ${SAL_BYTES}.`);
  }
  const derivada = pbkdf2Sha256(bytesDeTexto(password), sal, iteraciones, DERIVADA_BYTES);
  return `${ETIQUETA}$${iteraciones}$${hexDeBytes(sal)}$${hexDeBytes(derivada)}`;
}

/**
 * Comprueba una contrasena contra un verificador guardado.
 *
 * Devuelve `false` (y no lanza) ante un verificador corrupto o de un formato
 * desconocido: para quien llama, "no pude comprobarlo" y "no coincide" tienen
 * la misma consecuencia — no se abre la sesion — y distinguirlos con una
 * excepcion solo abre la puerta a que alguien la atrape mal y deje pasar el
 * login. Mismo criterio que `PasswordService.verificar` en el backend.
 */
export function verificarContrasena(password: string, verificador: string): boolean {
  const partes = verificador.split('$');
  if (partes.length !== 4 || partes[0] !== ETIQUETA) return false;

  const iteraciones = Number(partes[1]);
  if (!Number.isInteger(iteraciones) || iteraciones < 1) return false;

  let sal: Uint8Array;
  let esperada: Uint8Array;
  try {
    sal = bytesDeHex(partes[2] as string);
    esperada = bytesDeHex(partes[3] as string);
  } catch {
    return false;
  }
  if (sal.length === 0 || esperada.length === 0) return false;

  const derivada = pbkdf2Sha256(bytesDeTexto(password), sal, iteraciones, esperada.length);
  return igualesEnTiempoConstante(derivada, esperada);
}
