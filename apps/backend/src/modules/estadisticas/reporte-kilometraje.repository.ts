import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { FilaJornada } from './reglas-kilometraje';

export interface FiltroJornadas {
  desde: string;
  hasta: string;
  vehiculoId: string | null;
  /** `null` = todas las sucursales (usuario General sin filtro). */
  codigoSucursal: string | null;
}

@Injectable()
export class ReporteKilometrajeRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /**
   * Las jornadas vivas del rango, cada una con el `km_final` de la jornada
   * ANTERIOR del mismo vehiculo. El `lag` corre sobre TODO lo anterior a
   * `hasta` y el `desde` se aplica despues: asi el primer dia del rango se
   * compara con la ultima jornada previa (Review Focus 1). Las borradas no
   * entran ni como renglon ni como "anterior" (Review Focus 2).
   *
   * Orden `fecha, cerrada_en, id`: el mismo para el salto y para la pantalla
   * (desviacion 1 del plan). Los km salen en DECIMAS enteras desde SQL.
   */
  async jornadas(f: FiltroJornadas): Promise<FilaJornada[]> {
    const filas = await sql<{
      jornada_id: string;
      vehiculo_id: string;
      vehiculo_nombre: string;
      placas: string | null;
      vehiculo_activo: boolean;
      fecha: string;
      vendedor: string;
      km_inicial_decimas: number;
      km_final_decimas: number;
      km_final_anterior_decimas: number | null;
      fecha_anterior: string | null;
    }>`
      with base as (
        select j.id, j.vehiculo_id, j.vendedor_id, j.fecha, j.cerrada_en,
               j.km_inicial, j.km_final,
               lag(j.km_final) over w as km_final_anterior,
               lag(j.fecha) over w as fecha_anterior
          from jornada j
          join sucursal s on s.id = j.sucursal_id
         where j.deleted_at is null
           and j.fecha <= ${f.hasta}::date
           and (${f.vehiculoId}::uuid is null or j.vehiculo_id = ${f.vehiculoId}::uuid)
           and (${f.codigoSucursal}::text is null or s.codigo = ${f.codigoSucursal}::text)
        window w as (partition by j.vehiculo_id order by j.fecha, j.cerrada_en, j.id)
      )
      select b.id as jornada_id,
             b.vehiculo_id,
             v.nombre as vehiculo_nombre,
             v.placas,
             v.activo as vehiculo_activo,
             to_char(b.fecha, 'YYYY-MM-DD') as fecha,
             ve.nombre as vendedor,
             round(b.km_inicial * 10)::int as km_inicial_decimas,
             round(b.km_final * 10)::int as km_final_decimas,
             round(b.km_final_anterior * 10)::int as km_final_anterior_decimas,
             to_char(b.fecha_anterior, 'YYYY-MM-DD') as fecha_anterior
        from base b
        join vehiculo v on v.id = b.vehiculo_id
        join vendedor ve on ve.id = b.vendedor_id
       where b.fecha >= ${f.desde}::date
       order by b.vehiculo_id, b.fecha, b.cerrada_en, b.id
    `.execute(this.db);

    return filas.rows.map((r) => ({
      jornadaId: r.jornada_id,
      vehiculoId: r.vehiculo_id,
      vehiculoNombre: r.vehiculo_nombre,
      placas: r.placas,
      vehiculoActivo: r.vehiculo_activo,
      fecha: r.fecha,
      vendedor: r.vendedor,
      kmInicialDecimas: r.km_inicial_decimas,
      kmFinalDecimas: r.km_final_decimas,
      kmFinalAnteriorDecimas: r.km_final_anterior_decimas,
      fechaAnterior: r.fecha_anterior,
    }));
  }
}
