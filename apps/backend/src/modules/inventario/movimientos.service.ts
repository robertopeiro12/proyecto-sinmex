import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { MovimientoNormalizado } from './datos-movimiento';
import { MovimientoRechazado } from './movimiento-rechazado';
import { MovimientosRepository } from './movimientos.repository';

/**
 * Quien, cual y cuando. Todo sale del token o del sobre, nunca de `datos`: `id`
 * es la clave de la operacion (uuid validado en `prepararMovimiento`),
 * `sucursalId`/`vendedorId` los del token, `clienteId` el del sobre (ya paso por
 * el alcance del lote) y `fechaOperacion` la del sobre, sin re-derivarla de UTC.
 */
export interface ContextoMovimiento {
  id: string;
  sucursalId: string;
  vendedorId: string;
  clienteId: string | null;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadMovimiento {
  tabla: 'movimiento_inventario';
  id: string;
}

/**
 * Los movimientos de inventario en el servidor (T-27 pieza 2, D7): una sola
 * tabla para la merma del cliente, la del trayecto y el consumo. Vive en
 * `inventario/` (el modulo del vault al que pertenece el inventario del
 * vendedor); `sincronizacion/` solo lo despacha (ADR-0009).
 *
 * **No revisa el limite de consumo ni la existencia** (spec): las piezas ya
 * salieron de la camioneta; lo exige la tablet, como "exige foto" en la visita.
 */
@Injectable()
export class MovimientosService {
  constructor(private readonly repo: MovimientosRepository) {}

  /**
   * @throws {MovimientoRechazado} `presentacion-inexistente` o
   * `movimiento-id-ocupado`. No escribe nada antes de lanzar (y si lanzara
   * despues, el rollback de la operacion se lleva todo).
   */
  async registrarMovimiento(
    movimiento: MovimientoNormalizado,
    contexto: ContextoMovimiento,
    trx: Transaction<DB>,
  ): Promise<EntidadMovimiento> {
    const ids = [...new Set(movimiento.lineas.map((l) => l.presentacionId))];
    const existentes = await this.repo.presentacionesExistentes(ids, trx);
    const faltante = ids.find((id) => !existentes.has(id));
    if (faltante !== undefined) {
      // Sin esto la llave foranea saldria como 500 para todo el lote.
      throw new MovimientoRechazado({
        razon: 'presentacion-inexistente',
        motivo: `lineas: la presentación ${faltante} no existe en el catálogo.`,
      });
    }

    const id = await this.repo.insertar(
      {
        id: contexto.id,
        sucursalId: contexto.sucursalId,
        vendedorId: contexto.vendedorId,
        clienteId: contexto.clienteId,
        tipo: movimiento.tipo,
        fecha: contexto.fechaOperacion,
        comentario: movimiento.comentario,
        registradoEn: movimiento.registradoEn,
      },
      trx,
    );
    if (id === null) {
      // Neutro a proposito, como `gasto-id-ocupado` (T-30/T-31).
      throw new MovimientoRechazado({
        razon: 'movimiento-id-ocupado',
        motivo: 'El id de este movimiento ya está ocupado. Avisa a la oficina.',
      });
    }
    await this.repo.insertarLineas(id, movimiento.lineas, trx);
    return { tabla: 'movimiento_inventario', id };
  }
}
