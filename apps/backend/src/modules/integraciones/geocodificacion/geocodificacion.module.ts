import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GEOCODIFICADOR,
  type Geocodificador,
  type ResultadoGeocodificacion,
} from './geocodificador';
import { GeocodificadorFalso } from './geocodificador-falso';
import { GeocodificadorGoogle } from './google';

/**
 * Bajo `NODE_ENV=test` nada sale a la red aunque haya una clave en el .env:
 * responde `sin-configurar`. Los e2e que necesitan otra conducta sustituyen el
 * proveedor (`overrideProvider(GEOCODIFICADOR)`).
 */
class GeocodificadorDePruebas implements Geocodificador {
  geocodificar(): Promise<ResultadoGeocodificacion> {
    return Promise.resolve({ estado: 'sin-configurar' });
  }
}

/**
 * El geocodificador segun el entorno. Exportado para probarlo sin Nest.
 * `NODE_ENV` se lee por `config` (que cae al entorno del proceso) para poder
 * probar cada rama sin tocar `process.env`.
 */
export function crearGeocodificador(config: ConfigService): Geocodificador {
  const entorno = config.get<string>('NODE_ENV');
  if (entorno === 'test') return new GeocodificadorDePruebas();

  if (config.get<string>('GEOCODIFICADOR_FALSO') === '1') {
    const registro = new Logger('Geocodificacion');
    if (entorno === 'production') {
      // Un falso que ubica todo en el centro de Tijuana no debe llegar a produccion.
      registro.warn(
        'GEOCODIFICADOR_FALSO=1 se ignora en producción: se usa Google.',
      );
      return new GeocodificadorGoogle(config);
    }
    registro.warn(
      'GEOCODIFICADOR_FALSO=1: toda dirección se ubica en el centro de Tijuana sin llamar a Google. Solo para desarrollo.',
    );
    return new GeocodificadorFalso();
  }
  return new GeocodificadorGoogle(config);
}

/**
 * Integracion con la Geocoding API de Google (T-72, D4). Expone solo el token
 * `GEOCODIFICADOR`: quien lo usa (`cartera-clientes`) no sabe que es Google, y
 * los e2e lo sustituyen con `overrideProvider(GEOCODIFICADOR)`.
 */
@Module({
  providers: [
    {
      provide: GEOCODIFICADOR,
      inject: [ConfigService],
      useFactory: crearGeocodificador,
    },
  ],
  exports: [GEOCODIFICADOR],
})
export class GeocodificacionModule {}
