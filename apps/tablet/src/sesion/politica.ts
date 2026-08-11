/**
 * Politica de la sesion del vendedor **valida offline**.
 *
 * Funciones puras sobre un instante que se recibe de fuera (el `Reloj` de
 * `src/datos/reloj.ts`). Aqui no hay red, ni React, ni almacenamiento: es la
 * unica parte del ticket que se puede comprobar a fondo sin una tablet, asi
 * que es donde vive toda la decision.
 *
 * ## El problema
 *
 * El vendedor sale ~12 h a ruta sin conectividad. Necesita poder cerrar y
 * reabrir la app, o reiniciar la tablet, y seguir trabajando. Pero sin red no
 * se puede preguntarle al servidor si esa sesion sigue viva.
 *
 * ## El modelo
 *
 * Tres relojes distintos gobiernan la sesion, y **el mas estricto manda**:
 *
 * 1. **`sesionExpiraEn`** — vencimiento del refresh token en el servidor. Es la
 *    unica fecha que el servidor tambien conoce. Pasada, hay que volver a
 *    entrar en linea.
 * 2. **Ventana sin contacto** — `ultimoContactoServidor + ventanaOfflineHoras`.
 *    Es lo que acota el dano de una tablet perdida: por muy viva que este la
 *    sesion en el servidor, si la tablet lleva demasiado tiempo sin hablar con
 *    el, deja de servir sola. Sin esto, una baja de vendedor en el portal no
 *    tendria ningun efecto sobre un dispositivo que nunca vuelve a conectarse.
 * 3. **Intentos locales fallidos** — un contador persistente. Agotado, se borra
 *    el material local y hace falta red. Es lo que evita que quien encuentre la
 *    tablet pruebe contrasenas indefinidamente contra un KDF que, por rapido
 *    que sea, tampoco es infinito.
 *
 * El vencimiento del **access token** NO entra en esta decision: sirve para
 * hablar con la API, y offline no hay API con quien hablar. Confundir las dos
 * cosas es el error natural aqui.
 *
 * ## Lo que NO resuelve
 *
 * Ver `30-Decisiones/ADR-0005 Sesion del vendedor valida offline` en el vault
 * para el modelo de amenaza aceptado (tablet perdida, reloj manipulable,
 * revocacion que solo surte efecto al proximo contacto).
 */
import type { MomentoISO } from '@/datos/tipos';

/** Datos del vendedor que la app necesita tener a mano sin red. */
export interface VendedorSesion {
  id: string;
  login: string;
  nombre: string;
  sucursalId: string;
  sucursalCodigo: string;
  sucursalNombre: string;
}

/** Lo que el servidor decide y la tablet obedece. Llega en el login en linea. */
export interface PoliticaSesion {
  /** Horas que la tablet puede operar sin volver a hablar con el servidor. */
  ventanaOfflineHoras: number;
  /** Iteraciones de PBKDF2 con las que derivar el verificador local. */
  costeVerificador: number;
}

/**
 * La sesion tal como se guarda en el almacenamiento cifrado del dispositivo.
 *
 * **Nunca en SQLite ni en AsyncStorage**: la base local no esta cifrada y
 * cualquier respaldo del dispositivo se la lleva entera. Ver `almacen.ts`.
 */
export interface SesionGuardada {
  vendedor: VendedorSesion;
  /** JWT de acceso (`tipo: 'vendedor'`). Solo sirve para hablar con la API. */
  tokenAcceso: string;
  accesoExpiraEn: MomentoISO;
  /** Token de refresh opaco. Rota en cada uso, igual que en el portal. */
  tokenRefresh: string;
  /** Vencimiento del refresh EN EL SERVIDOR. */
  sesionExpiraEn: MomentoISO;
  /** Ultima vez que el servidor confirmo esta sesion (login o refresh). */
  ultimoContactoServidor: MomentoISO;
  politica: PoliticaSesion;
  /** `pbkdf2-sha256$...`, ver `src/seguridad/verificador.ts`. */
  verificador: string;
  /** Intentos locales fallidos consecutivos. */
  intentosFallidos: number;
}

/**
 * Intentos locales seguidos antes de exigir red.
 *
 * 10 y no 3: el vendedor teclea en una tablet, con guantes, bajo el sol, y
 * dejarlo fuera de su jornada por tres dedazos es un problema operativo real
 * (no puede llamar a soporte desde la ruta). 10 sigue haciendo inviable
 * adivinar una contrasena a mano.
 */
export const INTENTOS_LOCALES_MAX = 10;

/**
 * Tolerancia al desajuste del reloj, hacia atras.
 *
 * El reloj de la tablet no es monotono ni confiable: se puede atrasar solo (NTP
 * corrige unos segundos) o **a mano** (alguien que quiera estirar la ventana
 * offline). Un desajuste pequeno se ignora; uno grande se trata como sospechoso
 * y exige red. Sin esto, retrasar la fecha del dispositivo haria eterna la
 * ventana offline.
 */
export const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000;

export type MotivoRed =
  | 'sin-credenciales'
  | 'sesion-vencida'
  | 'ventana-vencida'
  | 'intentos-agotados'
  | 'reloj-inconsistente';

export type EstadoSesion =
  /** Hay material local: se puede re-autenticar con la contrasena, sin red. */
  | { tipo: 'reautenticacion-local'; vendedor: VendedorSesion; validaHasta: MomentoISO }
  /** No se puede resolver en el dispositivo: hace falta un login en linea. */
  | { tipo: 'requiere-red'; motivo: MotivoRed; vendedor: VendedorSesion | null };

function ms(momento: MomentoISO): number {
  return Date.parse(momento);
}

/**
 * Decide que puede hacer la app con lo que tiene guardado.
 *
 * Devuelve siempre uno de dos estados; no hay "sesion abierta" aqui a
 * proposito: **abrir la sesion siempre exige la contrasena**, en linea o
 * localmente. Mantener una sesion abierta entre arranques de la app
 * significaria que encontrar la tablet desbloqueada es encontrar la sesion
 * abierta, y el vendedor la deja en la camioneta.
 */
export function evaluarSesion(
  sesion: SesionGuardada | null,
  ahora: MomentoISO,
): EstadoSesion {
  if (!sesion) {
    return { tipo: 'requiere-red', motivo: 'sin-credenciales', vendedor: null };
  }

  const t = ms(ahora);
  const contacto = ms(sesion.ultimoContactoServidor);
  const expira = ms(sesion.sesionExpiraEn);

  // Fechas ilegibles = sesion corrupta. Se trata como no tenerla.
  if (!Number.isFinite(t) || !Number.isFinite(contacto) || !Number.isFinite(expira)) {
    return { tipo: 'requiere-red', motivo: 'sin-credenciales', vendedor: null };
  }

  if (sesion.intentosFallidos >= INTENTOS_LOCALES_MAX) {
    return { tipo: 'requiere-red', motivo: 'intentos-agotados', vendedor: sesion.vendedor };
  }

  if (t < contacto - TOLERANCIA_RELOJ_MS) {
    return { tipo: 'requiere-red', motivo: 'reloj-inconsistente', vendedor: sesion.vendedor };
  }

  if (t >= expira) {
    return { tipo: 'requiere-red', motivo: 'sesion-vencida', vendedor: sesion.vendedor };
  }

  const finVentana = contacto + sesion.politica.ventanaOfflineHoras * 60 * 60 * 1000;
  if (t >= finVentana) {
    return { tipo: 'requiere-red', motivo: 'ventana-vencida', vendedor: sesion.vendedor };
  }

  return {
    tipo: 'reautenticacion-local',
    vendedor: sesion.vendedor,
    // El mas estricto de los dos limites: es lo que la pantalla le muestra al
    // vendedor ("tu sesion sirve sin conexion hasta ...").
    validaHasta: new Date(Math.min(expira, finVentana)).toISOString(),
  };
}

/** Milisegundos que le quedan a la sesion offline, o 0 si ya no sirve. */
export function restanteOfflineMs(sesion: SesionGuardada | null, ahora: MomentoISO): number {
  const estado = evaluarSesion(sesion, ahora);
  if (estado.tipo !== 'reautenticacion-local') return 0;
  return Math.max(0, ms(estado.validaHasta) - ms(ahora));
}

/**
 * Si el JWT de acceso todavia sirve para llamar a la API.
 *
 * Solo importa cuando hay red. Se descuenta un margen de 30 s para no mandar
 * una peticion con un token que vence a mitad del viaje.
 */
export function accesoVigente(sesion: SesionGuardada, ahora: MomentoISO): boolean {
  return ms(sesion.accesoExpiraEn) - 30_000 > ms(ahora);
}

/** Suma un intento fallido de re-autenticacion local. */
export function conIntentoFallido(sesion: SesionGuardada): SesionGuardada {
  return { ...sesion, intentosFallidos: sesion.intentosFallidos + 1 };
}

/** Reinicia el contador tras una re-autenticacion correcta. */
export function conIntentosLimpios(sesion: SesionGuardada): SesionGuardada {
  return sesion.intentosFallidos === 0 ? sesion : { ...sesion, intentosFallidos: 0 };
}

/** Intentos locales que le quedan al vendedor antes de necesitar red. */
export function intentosRestantes(sesion: SesionGuardada): number {
  return Math.max(0, INTENTOS_LOCALES_MAX - sesion.intentosFallidos);
}
