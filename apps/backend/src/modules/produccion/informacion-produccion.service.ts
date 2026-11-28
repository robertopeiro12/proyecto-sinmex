import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ConsultaDetalleInformacionProduccionDto,
  ConsultaInformacionProduccionDto,
} from './dto/informacion-produccion.dto';
import {
  InformacionProduccionRepository,
  type FilaDetalleInformacion,
} from './informacion-produccion.repository';
import { InventarioPtService, type Ambito } from './inventario-pt.service';
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
} from './reglas-comunes';
import {
  MAX_DIAS_INFORMACION,
  ordenarInformacion,
  porProductoInformacion,
  type RenglonInformacion,
} from './reglas-informacion-produccion';
import { largoDelRango } from './reglas-inventario-pt';

export const MENSAJE_RANGO_INVERTIDO_INFORMACION =
  'La fecha inicial no puede ser posterior a la final.';
export const MENSAJE_RANGO_LARGO_INFORMACION =
  'El rango no puede pasar de un año.';

/** `GET /informacion-produccion`. */
export interface InformacionProduccion {
  desde: string;
  hasta: string;
  hoyEnTijuana: string;
  renglones: RenglonInformacion[];
}

/** `GET /informacion-produccion/detalle`. */
export interface DetalleInformacionProduccion {
  detalle: FilaDetalleInformacion[];
}

/**
 * Informacion de Produccion (spec 2026-11-28, D2–D7): reporte de solo lectura
 * de las Entradas/Compras del Registro de Operacion en un rango. El alcance, la
 * presentacion/producto pedido y "hoy" salen de PT con Ventas
 * (`InventarioPtService`), sin duplicar su logica.
 */
@Injectable()
export class InformacionProduccionService {
  constructor(
    private readonly repo: InformacionProduccionRepository,
    private readonly pt: InventarioPtService,
  ) {}

  async leer(
    usuarioId: string,
    q: ConsultaInformacionProduccionDto,
  ): Promise<InformacionProduccion> {
    const hoy = await this.exigirRango(q.desde, q.hasta);
    const ambito = await this.pt.ambito(usuarioId, q.sucursal);
    const filas = await this.repo.totales(
      sucursalesDe(ambito),
      q.desde,
      q.hasta,
    );
    const renglones: RenglonInformacion[] = filas.map((f) => ({
      ...f,
      total: f.produccion + f.compras,
    }));
    return {
      desde: q.desde,
      hasta: q.hasta,
      hoyEnTijuana: hoy,
      renglones:
        q.vista === 'producto'
          ? porProductoInformacion(renglones)
          : ordenarInformacion(renglones),
    };
  }

  async detalle(
    usuarioId: string,
    q: ConsultaDetalleInformacionProduccionDto,
  ): Promise<DetalleInformacionProduccion> {
    await this.exigirRango(q.desde, q.hasta);
    const objetivo = await this.pt.objetivo(q);
    const ambito = await this.pt.ambito(usuarioId, q.sucursal);
    return {
      detalle: await this.repo.detalle(
        sucursalesDe(ambito),
        objetivo.map((p) => p.presentacionId),
        q.desde,
        q.hasta,
      ),
    };
  }

  /** Fechas reales, `hasta` no futura, orden y largo; devuelve hoy en Tijuana. */
  private async exigirRango(desde: string, hasta: string): Promise<string> {
    const hoy = await this.pt.hoy();
    if (!esFechaReal(desde) || !esFechaReal(hasta))
      throw new BadRequestException(MENSAJE_FECHA_INVALIDA);
    if (hasta > hoy)
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: [MENSAJE_FECHA_FUTURA],
        hoyEnTijuana: hoy,
      });
    if (desde > hasta)
      throw new BadRequestException(MENSAJE_RANGO_INVERTIDO_INFORMACION);
    if (largoDelRango(desde, hasta) > MAX_DIAS_INFORMACION)
      throw new BadRequestException(MENSAJE_RANGO_LARGO_INFORMACION);
    return hoy;
  }
}

/**
 * Con Todas (`codigo` null, solo un General) no se filtra por sucursal: las
 * entradas de una sucursal dada de baja despues siguen contando (es historia).
 */
function sucursalesDe(ambito: Ambito): readonly string[] | null {
  return ambito.codigo === null ? null : ambito.sucursalIds;
}
