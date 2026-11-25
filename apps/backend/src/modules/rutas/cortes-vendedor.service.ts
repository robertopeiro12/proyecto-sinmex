import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { CorteRechazado } from './corte-rechazado';
import { CortesVendedorRepository } from './cortes-vendedor.repository';
import type { CorteNormalizado } from './datos-corte';

/**
 * Quien y cuando. Todo sale del token o del sobre, nunca de `datos`: el `id` es
 * la clave de la operacion, `fechaOperacion` la del sobre (no se re-deriva de UTC).
 */
export interface ContextoCorte {
  id: string;
  sucursalId: string;
  vendedorId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadCorte {
  tabla: 'corte_vendedor';
  id: string;
}

/**
 * El corte que el vendedor hace en la tablet al cerrar su dia (rediseño pieza
 * 6, spec §13): efectivo, notas que trae e inventario, cada uno con lo que
 * decia el sistema y lo que el capturo. **Informativo**: no toca saldos,
 * existencias ni el corte de mercancia de la oficina (`produccion/cortes.*`).
 * Vive en Rutas, junto a la jornada que cierra.
 */
@Injectable()
export class CortesVendedorService {
  constructor(private readonly repo: CortesVendedorRepository) {}

  /**
   * @throws {CorteRechazado} `corte-duplicado` (otro corte vivo ese dia) o
   * `id-ocupado`. No escribe nada antes de lanzar.
   */
  async registrarCorte(
    corte: CorteNormalizado,
    contexto: ContextoCorte,
    trx: Transaction<DB>,
  ): Promise<EntidadCorte> {
    const id = await this.repo.insertar(
      {
        id: contexto.id,
        vendedorId: contexto.vendedorId,
        sucursalId: contexto.sucursalId,
        fecha: contexto.fechaOperacion,
        efectivo: {
          esperado_centavos: corte.efectivo.esperadoCentavos,
          traido_centavos: corte.efectivo.traidoCentavos,
        },
        notas: corte.notas.map((n) => ({
          folio: n.folio,
          traida: n.traida,
          saldo_centavos: n.saldoCentavos,
        })),
        inventario: {
          renglones: corte.inventario.map((r) => ({
            presentacion_id: r.presentacionId,
            sistema: r.sistema,
            contado: r.contado,
          })),
          merma: corte.merma,
        },
        enviadoEn: corte.enviadoEn,
      },
      trx,
    );
    if (id !== null) return { tabla: 'corte_vendedor', id };

    if (
      await this.repo.hayCorteVivo(
        contexto.vendedorId,
        contexto.fechaOperacion,
        trx,
      )
    ) {
      throw new CorteRechazado({
        razon: 'corte-duplicado',
        motivo: `Ya hay un corte registrado para este vendedor el ${contexto.fechaOperacion}.`,
      });
    }
    throw new CorteRechazado({
      razon: 'id-ocupado',
      motivo: 'clave: el id de este corte ya está ocupado; avisa a la oficina.',
    });
  }
}
