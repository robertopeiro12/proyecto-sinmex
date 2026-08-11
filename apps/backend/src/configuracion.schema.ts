import Joi from 'joi';

/**
 * Validacion de las variables de entorno que gobiernan la autenticacion.
 *
 * Todas estas se leian antes como cadenas libres, y cada una tenia una forma
 * silenciosa de romper el sistema: un valor malo no daba error, daba un
 * comportamiento raro sin explicacion. El objetivo del schema no es limpiar
 * los tipos, es convertir esos fallos silenciosos en un fallo de arranque.
 *
 * Ojo con los tipos: cuando este schema esta activo, ConfigService devuelve
 * el valor YA CONVERTIDO por Joi (numero, booleano), no la cadena original.
 * AuthModule tambien puede compilarse sin este ConfigModule (las pruebas
 * unitarias lo hacen), y ahi los valores llegan como cadena. Por eso quien
 * lee COOKIE_SECURE y REFRESH_TOKEN_TTL_HORAS acepta ambas formas.
 */
export const configuracionSchema = Joi.object({
  // Sin secreto no se arranca. El minimo de 32 caracteres corresponde a lo
  // que produce el `openssl rand -base64 32` que documenta .env.example (44
  // caracteres); esta para atrapar un "cambiame" o un secreto de juguete.
  JWT_SECRET: Joi.string().min(32).required(),

  // Formato de la libreria 'ms'. Un typo como "15min" no falla al validar el
  // token: falla al FIRMARLO, es decir en cada login, ya en produccion.
  // Se acepta solo <numero><unidad> para no dejar pasar tambien los formatos
  // largos ("15 minutes") que confunden mas de lo que ayudan.
  ACCESS_TOKEN_TTL: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('15m')
    .messages({
      'string.pattern.base':
        'ACCESS_TOKEN_TTL debe ser <numero><s|m|h|d>, por ejemplo "15m".',
    }),

  // El default de @nestjs/config solo cubre `undefined`, no la cadena vacia:
  // un REFRESH_TOKEN_TTL_HORAS= (en blanco) en un .env copiado daba
  // Number('') === 0, y con eso cada sesion nacia ya vencida. El login
  // parecia funcionar y despues todo devolvia 401 sin ninguna pista.
  REFRESH_TOKEN_TTL_HORAS: Joi.number().integer().positive().default(12),

  // 'none' queda FUERA a proposito, aunque sea un valor legal de la spec:
  // sameSite es la unica defensa contra CSRF que tiene el sistema hoy (no
  // hay token CSRF), asi que ponerlo en 'none' la apaga entera. Y es
  // justamente lo que uno intenta cuando el portal y la API quedan en
  // dominios distintos y las cookies dejan de viajar. Ver README:
  // "Requisito de despliegue".
  COOKIE_SAMESITE: Joi.string().valid('lax', 'strict').default('lax'),

  COOKIE_SECURE: Joi.boolean().default(false),

  // --- App de tablet (T-06, segunda mitad) -------------------------------
  //
  // Todo en HORAS, igual que REFRESH_TOKEN_TTL_HORAS. Mezclar unidades (unas
  // en horas, otras en dias) es como se producen los desfases silenciosos que
  // ya documenta ttl-sesion.ts. El porque de cada default esta ahi.
  //
  // La app NO usa ACCESS_TOKEN_TTL (formato de la libreria 'ms'): su TTL se
  // expresa en horas y se convierte a segundos al firmar, para poder calcular
  // tambien la fecha exacta de vencimiento que la app necesita guardar.
  ACCESS_TOKEN_TTL_APP_HORAS: Joi.number().integer().positive().default(12),
  REFRESH_TOKEN_TTL_APP_HORAS: Joi.number()
    .integer()
    .positive()
    .default(7 * 24),

  // La ventana offline no puede superar la vida de la sesion: si lo hiciera, la
  // tablet creeria poder operar sin red mas alla de lo que el servidor
  // considera viva esa sesion, y el vendedor descubriria que no puede entrar
  // justo al intentar sincronizar. Joi lo comprueba al arrancar en vez de
  // dejarlo a la buena voluntad de quien edite el .env.
  VENTANA_OFFLINE_MAX_HORAS: Joi.number()
    .integer()
    .positive()
    .default(72)
    .max(Joi.ref('REFRESH_TOKEN_TTL_APP_HORAS'))
    .messages({
      'number.max':
        'VENTANA_OFFLINE_MAX_HORAS no puede superar REFRESH_TOKEN_TTL_APP_HORAS: la tablet no puede operar offline mas de lo que dura su sesion.',
    }),

  // Coste del KDF con el que la app deriva su verificador local. Se manda desde
  // aqui para poder ajustarlo cuando se mida en una tablet real, sin publicar
  // una version nueva de la app. El minimo evita que un cero o un valor de
  // juguete deje el verificador sin coste.
  VERIFICADOR_LOCAL_ITERACIONES: Joi.number()
    .integer()
    .min(10_000)
    .default(60_000),
});
