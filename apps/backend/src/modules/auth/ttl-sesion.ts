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
  // Llega como numero si el schema de AppModule esta activo (Joi convierte) y
  // como cadena si no. Number() cubre ambos casos.
  const horas = Number(
    config.get<string | number>(
      'REFRESH_TOKEN_TTL_HORAS',
      HORAS_REFRESH_POR_DEFECTO,
    ),
  );
  return horas * 60 * 60 * 1000;
}
