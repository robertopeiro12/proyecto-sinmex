import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GEOCODIFICADOR,
  type Geocodificador,
  type ResultadoGeocodificacion,
} from '../integraciones/geocodificacion/geocodificador';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import { ClientesRepository } from './clientes.repository';

/** Los motivos del spec (D5), exactos: el portal los pinta tal cual. */
export const MOTIVOS_UBICAR = {
  sinDomicilio: 'El cliente no tiene domicilio.',
  yaTiene: 'Ya tiene ubicación; bórrala primero para volver a ubicarlo.',
  imprecisa:
    'Google solo encontró la colonia o la ciudad: agrega calle y número.',
  noEncontrada: 'Google no encontró esa dirección.',
  sinConfigurar: 'Falta configurar la clave de Google en el servidor.',
  error: 'Google no respondió; intenta en un momento.',
} as const;

export interface UbicacionGeocodificada {
  lat: number;
  lng: number;
  ubicacionOrigen: 'geocodificada';
}

type ResultadoFallido = Exclude<ResultadoGeocodificacion, { estado: 'ok' }>;

/**
 * Convertir el domicilio de un cliente en coordenada (T-72, D5).
 *
 * Vive en Cartera de Clientes porque es la duena de `cliente` (ADR-0009); el
 * proveedor (Google) llega por el token `GEOCODIFICADOR` y no se conoce aqui.
 *
 * Dos entradas:
 * - `geocodificarEnSegundoPlano`: la disparan el push (despues del commit de un
 *   prospecto) y el guardado del portal, **sin esperarla**. Nunca rechaza.
 * - `ubicar`: el boton del portal. Esta si espera (Google tiene 5 s) y traduce
 *   cada resultado a 200/409/502.
 *
 * Sin reintentos, sin cola, sin cron: un intento perdido (reinicio del proceso,
 * Google caido) se repite a mano con el boton.
 */
@Injectable()
export class UbicacionClientesService {
  private readonly logger = new Logger(UbicacionClientesService.name);
  /** `sin-configurar` se avisa una sola vez por arranque, no en cada alta. */
  private avisoSinClaveDado = false;

  constructor(
    private readonly repo: ClientesRepository,
    @Inject(GEOCODIFICADOR) private readonly geocodificador: Geocodificador,
  ) {}

  /**
   * Un intento, si todavia hace falta: el cliente existe, no tiene coordenada y
   * tiene domicilio. Solo mira `lat` y `domicilio`: que el prospecto se haya
   * convertido en cliente mientras tanto no importa.
   */
  async geocodificarEnSegundoPlano(clienteId: string): Promise<void> {
    try {
      const cliente = await this.repo.ubicacionDe(clienteId);
      const domicilio = cliente?.domicilio?.trim() ?? '';
      if (!cliente || cliente.lat !== null || domicilio === '') return;

      const r = await this.geocodificador.geocodificar(domicilio);
      if (r.estado === 'ok') {
        await this.repo.guardarGeocodificada(clienteId, r.lat, r.lng);
        return;
      }
      this.registrar(clienteId, r);
    } catch (error) {
      // Nunca rechaza: quien llama no espera esta promesa, y un rechazo sin
      // `catch` tumbaria el proceso. Solo el nombre del error, no su mensaje.
      this.logger.warn(
        `Geocodificación del cliente ${clienteId}: falló sin resultado (${error instanceof Error ? error.name : 'error'}).`,
      );
    }
  }

  async ubicar(
    usuarioId: string,
    clienteId: string,
  ): Promise<UbicacionGeocodificada> {
    const cliente = await this.repo.ubicacionDe(clienteId);
    if (!cliente) throw new NotFoundException('No existe ese cliente.');

    // D5: fuera de alcance es 404, no 403: no confirma que el cliente exista.
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(fila.codigo, null);
    if (alcance.tipo === 'una' && alcance.codigo !== cliente.sucursalCodigo) {
      throw new NotFoundException('No existe ese cliente.');
    }

    const domicilio = cliente.domicilio?.trim() ?? '';
    if (domicilio === '') {
      throw new ConflictException(MOTIVOS_UBICAR.sinDomicilio);
    }
    if (cliente.lat !== null) {
      throw new ConflictException(MOTIVOS_UBICAR.yaTiene);
    }

    const r = await this.geocodificador.geocodificar(domicilio);
    switch (r.estado) {
      case 'ok': {
        const guardada = await this.repo.guardarGeocodificada(
          clienteId,
          r.lat,
          r.lng,
        );
        // Alguien capturo una coordenada mientras Google respondia: gana la suya.
        if (!guardada) throw new ConflictException(MOTIVOS_UBICAR.yaTiene);
        return { lat: r.lat, lng: r.lng, ubicacionOrigen: 'geocodificada' };
      }
      case 'imprecisa':
        throw new ConflictException(MOTIVOS_UBICAR.imprecisa);
      case 'no-encontrada':
        throw new ConflictException(MOTIVOS_UBICAR.noEncontrada);
      case 'sin-configurar':
        throw new ConflictException(MOTIVOS_UBICAR.sinConfigurar);
      case 'error':
        this.registrar(clienteId, r);
        throw new BadGatewayException(MOTIVOS_UBICAR.error);
    }
  }

  /** `warn` sin la clave: el `detalle` solo lleva el status de Google o el HTTP. */
  private registrar(clienteId: string, r: ResultadoFallido): void {
    if (r.estado === 'sin-configurar') {
      if (this.avisoSinClaveDado) return;
      this.avisoSinClaveDado = true;
      this.logger.warn(
        'Geocodificación: falta GOOGLE_MAPS_API_KEY; los clientes se quedan sin coordenada hasta configurarla.',
      );
      return;
    }
    this.logger.warn(
      `Geocodificación del cliente ${clienteId}: ${r.estado === 'error' ? r.detalle : r.estado}.`,
    );
  }
}
