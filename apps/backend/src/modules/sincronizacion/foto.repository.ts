import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';

/** Lo del buzon que hace falta para decidir si una foto puede entrar. */
export interface OperacionParaFoto {
  id: string;
  vendedorId: string;
  tipo: string;
  /** La fila de negocio en la que se proyecto (ADR-0009 §2.4). */
  entidadTabla: string | null;
  entidadId: string | null;
}

/**
 * La consulta al buzon que necesita `POST /sync/foto/:clave` (T-40).
 *
 * Archivo propio y no un metodo en `SincronizacionRepository` a proposito: ese
 * archivo es del contrato del `push` por lotes y lo estan tocando los tickets
 * que suman tipos de operacion. El canal de la foto no comparte nada con el
 * lote —ni contrato, ni codigos de rechazo, ni transaccion—, asi que tampoco
 * comparte archivo.
 */
@Injectable()
export class FotoRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Las operaciones con esa clave, **de cualquier vendedor**.
   *
   * Global y no filtrada por el vendedor del token, aunque eso seria mas corto,
   * porque son dos respuestas distintas y la tablet las trata distinto: una
   * clave que nadie tiene es `404` (la foto se queda pendiente o se descarta) y
   * una clave que es de OTRO vendedor es `403` (algo esta muy mal en el equipo).
   * Filtrando por vendedor las dos saldrian como 404 y el segundo caso no se
   * veria nunca.
   *
   * Devuelve una lista porque el `unique` del buzon es
   * `(vendedor_id, clave_idempotencia)`, no la clave sola: la misma clave en dos
   * vendedores es legal para la base. Con uuid v4 no pasa en la practica, pero
   * quien decide aqui es el esquema, no la probabilidad.
   */
  async porClave(clave: string): Promise<OperacionParaFoto[]> {
    const filas = await this.db
      .selectFrom('sync_operacion')
      .select(['id', 'vendedor_id', 'tipo', 'entidad_tabla', 'entidad_id'])
      .where('clave_idempotencia', '=', clave)
      .execute();

    return filas.map((f) => ({
      id: f.id,
      vendedorId: f.vendedor_id,
      tipo: f.tipo,
      entidadTabla: f.entidad_tabla,
      entidadId: f.entidad_id,
    }));
  }
}
