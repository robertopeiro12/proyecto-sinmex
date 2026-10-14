import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario } from '../sucursales/buscar-sucursal-usuario';
import type { ClienteNuevo } from './reglas-clientes-nuevos';

@Injectable()
export class ReporteClientesNuevosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  buscarSucursalUsuario(usuarioId: string) {
    return buscarSucursalUsuario(this.db, usuarioId);
  }

  /**
   * Clientes (no prospectos) cuya fecha de alta, en hora de Tijuana, cae en el
   * rango. Los clientes anteriores a T-51 no tienen `alta_cliente_en`: usan
   * `created_at`. Los dados de baja despues SI entran (fueron nuevos).
   */
  async clientes(f: {
    desde: string;
    hasta: string;
    codigoSucursal: string | null;
  }): Promise<ClienteNuevo[]> {
    const filas = await sql<{
      id: string;
      fecha_alta: string;
      nombre: string;
      sucursal_codigo: string;
      tipo_negocio: string | null;
      lista_precio: string | null;
      telefono: string;
      encargado: string | null;
      usuario: string | null;
      dado_de_baja: boolean;
    }>`
      select * from (
        select c.id,
               to_char((coalesce(c.alta_cliente_en, c.created_at) at time zone 'America/Tijuana')::date,
                       'YYYY-MM-DD') as fecha_alta,
               c.nombre, s.codigo as sucursal_codigo,
               tn.nombre as tipo_negocio, lp.nombre as lista_precio,
               c.telefono, c.encargado, u.nombre as usuario,
               c.deleted_at is not null as dado_de_baja
          from cliente c
          join sucursal s on s.id = c.sucursal_id
          left join tipo_negocio tn on tn.id = c.tipo_negocio_id
          left join lista_precio lp on lp.id = c.lista_precio_id
          left join usuario u on u.id = c.alta_cliente_usuario_id
         where c.tipo = 'cliente'
           and (${f.codigoSucursal}::text is null or s.codigo = ${f.codigoSucursal}::text)
      ) x
      where x.fecha_alta between ${f.desde} and ${f.hasta}
    `.execute(this.db);

    return filas.rows.map((r) => ({
      id: r.id,
      fechaAlta: r.fecha_alta,
      nombre: r.nombre,
      sucursalCodigo: r.sucursal_codigo,
      tipoNegocio: r.tipo_negocio,
      listaPrecio: r.lista_precio,
      telefono: r.telefono,
      encargado: r.encargado,
      usuario: r.usuario,
      dadoDeBaja: r.dado_de_baja,
    }));
  }
}
