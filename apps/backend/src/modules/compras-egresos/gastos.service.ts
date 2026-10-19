import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { GastoNormalizado } from './datos-gasto';
import { GastoRechazado } from './gasto-rechazado';
import { GastosRepository } from './gastos.repository';
import { METODO_GASTO_RUTA } from './tipos-egreso';

/**
 * Quien, cual y cuando. Todo sale del token o del sobre, nunca de `datos`:
 * `id` es la clave de la operacion (uuid validado en `prepararGasto`),
 * `sucursalId`/`vendedorId` los del token y `fechaOperacion` la del sobre, sin
 * re-derivarla de UTC.
 */
export interface ContextoGasto {
  id: string;
  sucursalId: string;
  vendedorId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadGasto {
  tabla: 'gasto';
  id: string;
}

/**
 * Los gastos en el servidor (T-30/T-31). Proyecta el `tipo: 'gasto'` que sube
 * la tablet; vive en `compras-egresos/` (ADR-0009). El siguiente ticket le suma
 * las compras de oficina del portal sobre la misma tabla.
 *
 * **No revisa `se_usa_en_app`** (D5): la oficina puede cambiar la casilla
 * mientras la tablet esta sin red, y rechazar un gasto ya pagado por eso seria
 * perder el dinero de vista.
 */
@Injectable()
export class GastosService {
  constructor(private readonly repo: GastosRepository) {}

  /**
   * @throws {GastoRechazado} `campo-egreso-inexistente` o `gasto-id-ocupado`.
   * No escribe nada antes de lanzar.
   */
  async registrarGasto(
    gasto: GastoNormalizado,
    contexto: ContextoGasto,
    trx: Transaction<DB>,
  ): Promise<EntidadGasto> {
    const campo = await this.repo.campoParaGasto(gasto.campoEgresoId, trx);
    if (!campo) {
      throw new GastoRechazado({
        razon: 'campo-egreso-inexistente',
        motivo: `El campo de egreso ${gasto.campoEgresoId} no existe en el catálogo.`,
      });
    }
    const quien = await this.repo.nombreVendedor(contexto.vendedorId, trx);

    const id = await this.repo.insertar(
      {
        id: contexto.id,
        sucursalId: contexto.sucursalId,
        vendedorId: contexto.vendedorId,
        campoEgresoId: gasto.campoEgresoId,
        // Copia (D4): editar el campo despues no cambia lo ya registrado.
        campoNombre: campo.nombre,
        tipo: campo.tipo,
        fecha: contexto.fechaOperacion,
        registradoEn: gasto.registradoEn,
        montoCentavos: gasto.montoCentavos,
        metodo: METODO_GASTO_RUTA,
        origen: 'app',
        quien,
        comentario: gasto.comentario,
      },
      trx,
    );
    if (id === null) {
      // Neutro a proposito, como `visita-id-ocupado` (T-39).
      throw new GastoRechazado({
        razon: 'gasto-id-ocupado',
        motivo: 'El id de este gasto ya está ocupado. Avisa a la oficina.',
      });
    }
    return { tabla: 'gasto', id };
  }

  /** T-30 (D8): para el canal de fotos. */
  existe(id: string): Promise<boolean> {
    return this.repo.existe(id);
  }

  /** T-30 (D8): el archivo ya esta en disco; esto anota la columna. */
  anotarFoto(id: string, archivo: string, subidaEn: Date): Promise<boolean> {
    return this.repo.anotarFoto(id, archivo, subidaEn);
  }
}
