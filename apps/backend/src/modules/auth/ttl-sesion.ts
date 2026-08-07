import type { ConfigService } from '@nestjs/config';

/**
 * Duracion de la sesion de refresh, en milisegundos.
 *
 * Existe una sola vez a proposito: el mismo numero manda sobre DOS cosas que
 * tienen que coincidir — el `expira_en` que TokenService guarda en
 * sesion_refresh y el `maxAge` de las cookies que pone AuthController. Cuando
 * cada uno leia la variable y multiplicara por su cuenta, bastaba con tocar
 * una de las dos formulas para que la cookie y la fila de la base vencieran en
 * momentos distintos, sin que nada fallara de forma visible: la sesion moria
 * antes o despues de lo que decia la configuracion.
 *
 * El default de 12 h se repite aqui (y no solo en el schema de validacion de
 * AppModule) porque AuthModule se puede compilar sin ese ConfigModule — las
 * pruebas unitarias lo hacen — y en ese caso nadie inyecta el default.
 */
export const HORAS_REFRESH_POR_DEFECTO = 12;

export function msDeSesionRefresh(config: ConfigService): number {
  return horasEnMs(
    config,
    'REFRESH_TOKEN_TTL_HORAS',
    HORAS_REFRESH_POR_DEFECTO,
  );
}

// ---------------------------------------------------------------------------
// App de tablet (T-06, segunda mitad)
// ---------------------------------------------------------------------------
//
// Los TTL de la app son distintos de los del portal, y no por gusto: el portal
// vive en un navegador con red permanente, donde un access token de 15 minutos
// no le cuesta nada al usuario porque el refresh ocurre solo. El vendedor sale
// ~12 h a ruta SIN conectividad. Un token de 15 minutos ahi no se puede
// renovar, y la app no podria ni intentar hablar con la API si aparece senal a
// media jornada.
//
// Todos los TTL de la app se expresan en HORAS, igual que el del portal: tener
// unos en horas y otros en dias es exactamente el tipo de deriva que ya costo
// un incidente en este archivo (ver el comentario de arriba).

/**
 * Vida del JWT de acceso de la app. 12 h = una jornada completa.
 *
 * Ojo con lo que compra y lo que no: **no** es lo que mantiene viva la sesion
 * offline (offline nadie puede verificar un JWT). Es lo que permite que la app
 * llame a la API en cualquier momento de la jornada sin una ida y vuelta de
 * refresh — util cuando aparece senal a media ruta y para el `push` de T-07 al
 * volver al negocio.
 */
export const HORAS_ACCESO_APP_POR_DEFECTO = 12;

/**
 * Vida de la sesion de refresh de la app: 7 dias.
 *
 * Es mas larga que las 12 h del portal porque la tablet no puede pedirle la
 * contrasena al vendedor cada dia si no hay red para validarla. Con 7 dias, una
 * tablet que sincroniza a diario nunca ve la pantalla de "vuelve a entrar".
 *
 * > [!warning] Pendiente de confirmar con el cliente
 * > Cuantos dias puede una tablet estar sin contacto con el negocio (vacaciones
 * > del vendedor, fin de semana largo, tablet en reparacion) NO esta en las
 * > fuentes del vault. 7 dias es una eleccion conservadora nuestra, no un dato
 * > del negocio.
 */
export const HORAS_SESION_APP_POR_DEFECTO = 7 * 24;

/**
 * Ventana maxima que la tablet puede operar **sin hablar con el servidor**: 72 h.
 *
 * Es el limite que de verdad acota el dano de una tablet perdida, y es mas
 * estricto que la sesion de 7 dias a proposito: la sesion mide "cuanto vale
 * esta credencial", la ventana mide "cuanto tiempo confio en un dispositivo al
 * que no puedo preguntarle nada". El modelo de negocio es sincronizar por WiFi
 * al volver al negocio **cada dia** ([[Sincronizacion offline]]), asi que 72 h
 * ya deja margen para un fin de semana o un dia con la WiFi caida.
 *
 * > [!warning] Pendiente de confirmar con el cliente
 * > Mismo caso que arriba: el numero no sale de las fuentes.
 */
export const HORAS_VENTANA_OFFLINE_POR_DEFECTO = 72;

/**
 * Iteraciones de PBKDF2 con las que la app deriva su verificador local.
 *
 * Lo decide el servidor (y no una constante compilada en el APK) porque el
 * valor correcto depende del hardware de las tablets, que hoy no tenemos para
 * medir: cuando se sepa cuanto tarda de verdad, se ajusta esta variable y las
 * tablets lo recogen en su siguiente login, sin publicar una version nueva.
 * Ver `src/seguridad/verificador.ts` en `apps/tablet`.
 */
export const ITERACIONES_VERIFICADOR_POR_DEFECTO = 60_000;

export function msDeAccesoApp(config: ConfigService): number {
  return horasEnMs(
    config,
    'ACCESS_TOKEN_TTL_APP_HORAS',
    HORAS_ACCESO_APP_POR_DEFECTO,
  );
}

export function msDeSesionApp(config: ConfigService): number {
  return horasEnMs(
    config,
    'REFRESH_TOKEN_TTL_APP_HORAS',
    HORAS_SESION_APP_POR_DEFECTO,
  );
}

export function horasDeVentanaOffline(config: ConfigService): number {
  return Number(
    config.get<string | number>(
      'VENTANA_OFFLINE_MAX_HORAS',
      HORAS_VENTANA_OFFLINE_POR_DEFECTO,
    ),
  );
}

export function iteracionesVerificador(config: ConfigService): number {
  return Number(
    config.get<string | number>(
      'VERIFICADOR_LOCAL_ITERACIONES',
      ITERACIONES_VERIFICADOR_POR_DEFECTO,
    ),
  );
}

/**
 * Lee una variable de horas y la devuelve en milisegundos.
 *
 * Llega como numero si el schema de AppModule esta activo (Joi convierte) y
 * como cadena si no (pruebas unitarias, AuthModule montado suelto). `Number()`
 * cubre ambos casos.
 */
function horasEnMs(
  config: ConfigService,
  clave: string,
  porDefecto: number,
): number {
  return (
    Number(config.get<string | number>(clave, porDefecto)) * 60 * 60 * 1000
  );
}
