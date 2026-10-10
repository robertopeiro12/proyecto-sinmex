import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { JornadaNormalizada } from './datos-jornada';
import { JornadaRechazada } from './jornada-rechazada';
import { JornadasRepository } from './jornadas.repository';

/**
 * Quien y cuando. Todo sale del token o del sobre, nunca de `datos`:
 *
 * - `sucursalId` y `vendedorId`: los del vendedor del token (`vendedorEnAlcance`
 *   ya paso por `resolverAlcance()`).
 * - `fechaOperacion`: la del sobre, tal cual la calculo la tablet. El servidor
 *   no la re-deriva de UTC.
 */
export interface ContextoJornada {
  sucursalId: string;
  vendedorId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadJornada {
  tabla: 'jornada';
  id: string;
}

/**
 * La jornada del vendedor en el servidor (T-38): proyecta el `tipo: 'jornada'`
 * que sube la tablet a la tabla `jornada`, de donde leera el reporte de
 * Kilometraje del portal. Vive en `rutas/` porque `Vehículo.md` declara
 * `modulo: rutas` y ADR-0009 le asigna `JornadasService.cerrarJornada`.
 */
@Injectable()
export class JornadasService {
  constructor(private readonly repo: JornadasRepository) {}

  /**
   * Registra una jornada cerrada cuya forma ya valido `normalizarDatosJornada`,
   * dentro de la transaccion de quien llama.
   *
   * Un vehiculo **desactivado** (`activo = false`) se acepta: el portal pudo
   * desactivarlo despues de que el vendedor abrio el dia, y esos kilometros se
   * recorrieron igual. Solo el que no existe, esta dado de baja (`deleted_at`)
   * o es de otra sucursal se rechaza.
   *
   * @throws {JornadaRechazada} `vehiculo-inexistente` o `jornada-duplicada`.
   * No escribe nada antes de lanzar.
   */
  async cerrarJornada(
    jornada: JornadaNormalizada,
    contexto: ContextoJornada,
    trx: Transaction<DB>,
  ): Promise<EntidadJornada> {
    const vehiculoValido = await this.repo.vehiculoDeLaSucursal(
      jornada.vehiculoId,
      contexto.sucursalId,
      trx,
    );
    if (!vehiculoValido) {
      throw new JornadaRechazada({
        razon: 'vehiculo-inexistente',
        motivo: `El vehículo ${jornada.vehiculoId} no existe, está dado de baja o no es de tu sucursal.`,
      });
    }

    const id = await this.repo.insertar(
      {
        vendedorId: contexto.vendedorId,
        vehiculoId: jornada.vehiculoId,
        sucursalId: contexto.sucursalId,
        fecha: contexto.fechaOperacion,
        kmInicial: jornada.kmInicial,
        kmFinal: jornada.kmFinal,
        abiertaEn: jornada.abiertaEn,
        cerradaEn: jornada.cerradaEn,
      },
      trx,
    );
    if (id === null) {
      throw new JornadaRechazada({
        razon: 'jornada-duplicada',
        motivo: `Ya hay una jornada registrada para este vendedor el ${contexto.fechaOperacion}.`,
      });
    }

    return { tabla: 'jornada', id };
  }
}
