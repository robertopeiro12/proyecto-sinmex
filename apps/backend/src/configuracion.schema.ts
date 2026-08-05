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
});
