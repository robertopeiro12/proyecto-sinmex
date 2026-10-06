import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { MAX_OPERACIONES_POR_DIA } from '../sincronizacion/folio';
import { FoliosOficinaAgotados, folioDeOficina } from './folio-oficina';

/**
 * El contador del folio de oficina (T-17, §4.4).
 *
 * Como `VentasRepository`: recibe la `trx` y no abre la suya. **Tiene** que
 * correr dentro de la transaccion de la venta: si la venta falla despues, el
 * rollback deshace tambien el incremento y el numero no se quema.
 */
@Injectable()
export class FoliosOficinaRepository {
  /**
   * El siguiente folio de oficina de esa sucursal y ese dia.
   *
   * `insert ... on conflict do update ... returning`: una sola sentencia, sin
   * SELECT previo. La fila queda bloqueada hasta el commit, asi que una segunda
   * venta simultanea espera y luego ve el numero ya incrementado; no hay
   * ventana en la que dos obtengan el mismo.
   *
   * @throws {FoliosOficinaAgotados} si pasaria de 99. Quien llama deja que su
   * transaccion haga rollback, asi que el contador se queda en 99.
   */
  async emitir(
    sucursal: { id: string; codigo: string },
    fecha: string,
    trx: Transaction<DB>,
  ): Promise<string> {
    const resultado = await sql<{ ultimo: number }>`
      insert into folio_oficina_contador (sucursal_id, fecha, ultimo)
      values (${sucursal.id}, ${fecha}::date, 1)
      on conflict (sucursal_id, fecha)
      do update set ultimo = folio_oficina_contador.ultimo + 1
      returning ultimo
    `.execute(trx);

    const consecutivo = resultado.rows[0].ultimo;
    if (consecutivo > MAX_OPERACIONES_POR_DIA) {
      throw new FoliosOficinaAgotados(fecha);
    }
    return folioDeOficina(sucursal.codigo, fecha, consecutivo);
  }
}
