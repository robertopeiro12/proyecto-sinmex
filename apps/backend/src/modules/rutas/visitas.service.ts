import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { VisitaNormalizada } from './datos-visita';
import { VisitaRechazada } from './visita-rechazada';
import { VisitasRepository } from './visitas.repository';

/**
 * Quien, cual y cuando. Todo sale del token o del sobre, nunca de `datos`:
 * `id` es la clave de la operacion (uuid validado en `prepararVisita`),
 * `sucursalId`/`vendedorId` los del token, `clienteId` el del sobre (ya paso el
 * alcance del lote) y `fechaOperacion` la del sobre, sin re-derivarla de UTC.
 */
export interface ContextoVisita {
  id: string;
  sucursalId: string;
  vendedorId: string;
  clienteId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadVisita {
  tabla: 'visita';
  id: string;
}

/**
 * La visita sin venta en el servidor (T-39): proyecta el `tipo: 'visita'` que
 * sube la tablet. Vive en `rutas/` porque la visita es de Rutas (ADR-0009).
 *
 * **No revisa `exige_foto` ni `exige_atendio`** (D3): la oficina puede cambiar
 * las casillas mientras la tablet esta sin red, y rechazar una visita ya hecha
 * por un cambio posterior seria injusto. Lo exige la tablet al guardar.
 */
@Injectable()
export class VisitasService {
  constructor(private readonly repo: VisitasRepository) {}

  /**
   * @throws {VisitaRechazada} `motivo-visita-inexistente` o `visita-id-ocupado`.
   * No escribe nada antes de lanzar.
   */
  async registrarVisita(
    visita: VisitaNormalizada,
    contexto: ContextoVisita,
    trx: Transaction<DB>,
  ): Promise<EntidadVisita> {
    if (!(await this.repo.motivoExiste(visita.motivoVisitaId, trx))) {
      throw new VisitaRechazada({
        razon: 'motivo-visita-inexistente',
        motivo: `El motivo de visita ${visita.motivoVisitaId} no existe en el catálogo.`,
      });
    }

    const id = await this.repo.insertar(
      {
        id: contexto.id,
        vendedorId: contexto.vendedorId,
        sucursalId: contexto.sucursalId,
        clienteId: contexto.clienteId,
        motivoVisitaId: visita.motivoVisitaId,
        fecha: contexto.fechaOperacion,
        visitadaEn: visita.visitadaEn,
        observaciones: visita.observaciones,
        atendio: visita.atendio,
        lat: visita.lat,
        lng: visita.lng,
        precisionM: visita.precisionM,
        direccionTexto: visita.direccionTexto,
      },
      trx,
    );
    if (id === null) {
      // Neutro a proposito, como `id-ocupado` del prospecto (T-75): no confirma
      // que hay detras de ese id.
      throw new VisitaRechazada({
        razon: 'visita-id-ocupado',
        motivo: 'El id de esta visita ya está ocupado. Avisa a la oficina.',
      });
    }
    return { tabla: 'visita', id };
  }

  /** T-39 (D9): para el canal de fotos. */
  existe(id: string): Promise<boolean> {
    return this.repo.existe(id);
  }

  /** T-39 (D9): el archivo ya esta en disco; esto anota la columna. */
  anotarFoto(id: string, archivo: string, subidaEn: Date): Promise<boolean> {
    return this.repo.anotarFoto(id, archivo, subidaEn);
  }
}
