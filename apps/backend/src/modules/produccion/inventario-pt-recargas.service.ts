import { Injectable } from '@nestjs/common';
import type {
  ConsultaDetallePtRecargasDto,
  ConsultaInventarioPtRecargasDto,
} from './dto/inventario-pt-recargas.dto';
import {
  InventarioPtRecargasRepository,
  type FilaDetalleRecargas,
} from './inventario-pt-recargas.repository';
import { InventarioPtRepository } from './inventario-pt.repository';
import { InventarioPtService } from './inventario-pt.service';
import {
  actualDelDia,
  hayMovimientoRecargas,
  ordenarRecargasPorPresentacion,
  porProductoRecargas,
  SIN_MOVIMIENTOS_RECARGAS,
  sumarMovimientosRecargas,
  type MovimientosRecargas,
  type RenglonPtRecargas,
} from './reglas-inventario-pt-recargas';

/** `GET /inventario-pt/recargas`. */
export interface InventarioPtRecargas {
  /** Hoy en Tijuana (la pantalla no tiene fecha). */
  fecha: string;
  hoyEnTijuana: string;
  /** Hora de la consulta en Tijuana, `hh:mm`. */
  consultadoEn: string;
  renglones: RenglonPtRecargas[];
}

/** `GET /inventario-pt/recargas/detalle`. */
export interface DetallePtRecargas {
  detalle: FilaDetalleRecargas[];
}

/**
 * Inventario de PT con Recargas (spec 2026-11-25-inventario-pt-recargas, D2–D7):
 * solo lectura y solo hoy. Los movimientos salen de cargas y Registro de
 * Operacion (`inventario-pt-recargas.repository.ts`); el Inicial, el alcance,
 * la presentacion/producto pedido y "hoy" salen de PT con Ventas, sin duplicar
 * su cuenta (`InventarioPtService`).
 */
@Injectable()
export class InventarioPtRecargasService {
  constructor(
    private readonly repo: InventarioPtRecargasRepository,
    private readonly pt: InventarioPtService,
    private readonly ptRepo: InventarioPtRepository,
  ) {}

  async leer(
    usuarioId: string,
    q: ConsultaInventarioPtRecargasDto,
  ): Promise<InventarioPtRecargas> {
    const ambito = await this.pt.ambito(usuarioId, q.sucursal);
    const [hoy, consultadoEn] = await Promise.all([
      this.pt.hoy(),
      this.repo.horaEnTijuana(),
    ]);
    const filas = await this.repo.movimientos(ambito.sucursalIds, hoy);
    // Movimientos sumados por presentacion (con Todas, sobre las sucursales).
    const porPresentacion = new Map<string, MovimientosRecargas>();
    for (const f of filas)
      porPresentacion.set(
        f.presentacionId,
        sumarMovimientosRecargas(
          porPresentacion.get(f.presentacionId) ?? SIN_MOVIMIENTOS_RECARGAS,
          f,
        ),
      );
    // Las vivas, mas las dadas de baja con movimiento hoy o con un ajuste vivo
    // <= hoy en el ambito (la misma regla de visibilidad de PT con Ventas:
    // tiene inventario que encadenar). Una sola consulta agrupada.
    const conMovimiento = [...porPresentacion]
      .filter(([, m]) => hayMovimientoRecargas(m))
      .map(([id]) => id);
    const ajustes = await this.ptRepo.ajustes(
      ambito.sucursalIds,
      hoy,
      hoy,
      null,
    );
    const presentaciones = await this.ptRepo.presentaciones([
      ...conMovimiento,
      ...ajustes.map((a) => a.presentacionId),
    ]);
    const iniciales = await this.pt.inicialesDelDia(
      ambito,
      presentaciones,
      hoy,
    );
    const renglones: RenglonPtRecargas[] = presentaciones.map((p) => {
      const m = porPresentacion.get(p.presentacionId) ?? {
        ...SIN_MOVIMIENTOS_RECARGAS,
      };
      const ini = iniciales.get(p.presentacionId);
      const inicial = ini?.inicial ?? null;
      return {
        presentacionId: p.presentacionId,
        productoId: p.productoId,
        producto: p.producto,
        volumen: p.volumen,
        ...soloMovimientos(m),
        inicial,
        actual: actualDelDia(inicial, m),
      };
    });
    return {
      fecha: hoy,
      hoyEnTijuana: hoy,
      consultadoEn,
      renglones:
        q.vista === 'producto'
          ? porProductoRecargas(renglones)
          : ordenarRecargasPorPresentacion(renglones),
    };
  }

  async detalle(
    usuarioId: string,
    q: ConsultaDetallePtRecargasDto,
  ): Promise<DetallePtRecargas> {
    const objetivo = await this.pt.objetivo(q);
    const ambito = await this.pt.ambito(usuarioId, q.sucursal);
    const hoy = await this.pt.hoy();
    const ids = objetivo.map((p) => p.presentacionId);
    return {
      detalle: await this.repo.detalleRecargas(ambito.sucursalIds, ids, hoy),
    };
  }
}

/** Solo las columnas de movimiento (la fila del repositorio trae sus llaves). */
function soloMovimientos(m: MovimientosRecargas): MovimientosRecargas {
  return sumarMovimientosRecargas(SIN_MOVIMIENTOS_RECARGAS, m);
}
