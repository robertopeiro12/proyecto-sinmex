import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { RutaAltaNormalizada } from './datos-ruta-alta';
import { RutaRechazada } from './ruta-rechazada';
import { RutasDiariasRepository } from './rutas-diarias.repository';

/**
 * Quien y cuando de un alta de ruta. Todo sale del token o del sobre:
 *
 * - `sucursalId` y `vendedorId`: los del vendedor del token.
 * - `fechaOperacion`: la del sobre, tal cual la calculo la tablet. El servidor
 *   no la re-deriva de UTC; un alta capturada ayer sin red y subida hoy cae en
 *   la ruta de AYER.
 */
export interface ContextoRutaAlta {
  sucursalId: string;
  vendedorId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadRuta {
  tabla: 'ruta';
  id: string;
}

/**
 * La ruta diaria en el servidor (T-37): la proyeccion de `ruta-alta` (aqui) y
 * la pantalla Ruta Diaria del portal (Tarea 5). Vive en `rutas/` porque es el
 * slug del vault para [[Rutas]].
 */
@Injectable()
export class RutasDiariasService {
  constructor(private readonly repo: RutasDiariasRepository) {}

  /**
   * Agrega al final de la ruta de ese dia un cliente que el vendedor sumo a
   * mano, dentro de la transaccion de quien llama (ADR-0009).
   *
   * @throws {RutaRechazada} `cliente-inexistente` o `ruta-duplicada`. No
   * escribe nada antes de lanzar.
   */
  async agregarAlDia(
    alta: RutaAltaNormalizada,
    contexto: ContextoRutaAlta,
    trx: Transaction<DB>,
  ): Promise<EntidadRuta> {
    const valido = await this.repo.clienteParaRuta(
      alta.clienteId,
      contexto.sucursalId,
      trx,
    );
    if (!valido) {
      throw new RutaRechazada({
        razon: 'cliente-inexistente',
        motivo: `El cliente ${alta.clienteId} no existe, está dado de baja, es un prospecto o no es de tu sucursal.`,
      });
    }

    // Antes de leer el orden: ver `bloquearVendedor`.
    await this.repo.bloquearVendedor(contexto.vendedorId, trx);
    const orden = await this.repo.siguienteOrden(
      contexto.vendedorId,
      contexto.fechaOperacion,
      trx,
    );

    const id = await this.repo.insertarSiNoExiste(
      {
        vendedorId: contexto.vendedorId,
        clienteId: alta.clienteId,
        fecha: contexto.fechaOperacion,
        orden,
        origen: 'vendedor',
      },
      trx,
    );
    if (id === null) {
      // La oficina (u otra tablet) ya lo tenia. La tablet lo trata como
      // aplicado (D15): no es un error del vendedor.
      throw new RutaRechazada({
        razon: 'ruta-duplicada',
        motivo: `El cliente ya está en tu ruta del ${contexto.fechaOperacion}.`,
      });
    }

    return { tabla: 'ruta', id };
  }
}
