import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { NotaNoCobradaNormalizada } from './datos-nota-no-cobrada';
import { NotaNoCobradaRechazada } from './nota-no-cobrada-rechazada';
import { NotasNoCobradasRepository } from './notas-no-cobradas.repository';

/**
 * Todo sale del token o del sobre, nunca de `datos`: `id` es la clave de la
 * operacion (uuid validado en `prepararNotaNoCobrada`), `sucursalId` y
 * `vendedorId` los del token, `clienteId` el del sobre (ya paso el alcance del
 * lote) y `fechaOperacion` la del sobre, sin re-derivarla de UTC.
 */
export interface ContextoNotaNoCobrada {
  id: string;
  sucursalId: string;
  vendedorId: string;
  clienteId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadNotaNoCobrada {
  tabla: 'nota_no_cobrada';
  id: string;
}

/**
 * El "no cobre" de una nota asignada: proyecta el `tipo: 'nota-no-cobrada'`
 * que sube la tablet. Vive en `rutas/` porque la nota asignada es de Rutas.
 *
 * **No consulta `nota_asignada`** (decision 13): el comentario entra aunque la
 * nota ya no este asignada al vendedor o nunca lo haya estado; la oficina
 * puede haberla pasado a otro mientras la tablet estaba sin red.
 */
@Injectable()
export class NotasNoCobradasService {
  constructor(private readonly repo: NotasNoCobradasRepository) {}

  /**
   * @throws {NotaNoCobradaRechazada} `nota-no-encontrada` o
   * `nota-no-cobrada-id-ocupado`. No escribe nada antes de lanzar.
   */
  async registrar(
    nota: NotaNoCobradaNormalizada,
    ctx: ContextoNotaNoCobrada,
    trx: Transaction<DB>,
  ): Promise<EntidadNotaNoCobrada> {
    const venta = await this.repo.notaDe(nota.ventaNotaId, trx);
    // Un solo motivo neutro para los tres casos (no existe, otro cliente, otra
    // sucursal): no confirma que la nota exista.
    if (
      venta === undefined ||
      venta.clienteId !== ctx.clienteId ||
      venta.clienteSucursalId !== ctx.sucursalId
    ) {
      throw new NotaNoCobradaRechazada({
        razon: 'nota-no-encontrada',
        motivo: `La nota ${nota.ventaNotaId} no se encontró para este cliente.`,
      });
    }

    const insertada = await this.repo.insertar(
      {
        id: ctx.id,
        ventaNotaId: nota.ventaNotaId,
        vendedorId: ctx.vendedorId,
        sucursalId: ctx.sucursalId,
        fecha: ctx.fechaOperacion,
        comentario: nota.comentario,
        registradoEn: nota.registradoEn,
      },
      trx,
    );
    if (!insertada) {
      // Neutro a proposito: no confirma que hay detras de ese id.
      throw new NotaNoCobradaRechazada({
        razon: 'nota-no-cobrada-id-ocupado',
        motivo: 'El id de este comentario ya está ocupado. Avisa a la oficina.',
      });
    }
    return { tabla: 'nota_no_cobrada', id: ctx.id };
  }
}
