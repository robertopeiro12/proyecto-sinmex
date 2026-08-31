import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aNumero } from '../sincronizacion/dinero';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';

export interface ListaPrecio {
  id: string;
  nombre: string;
}

export interface PrecioVigente {
  presentacionId: string;
  listaPrecioId: string;
  precio: number;
  vigenteDesde: string;
}

interface FilaVigente {
  presentacion_id: string;
  lista_precio_id: string;
  precio: string;
  vigente_desde: string;
}

function aPrecioVigente(fila: FilaVigente): PrecioVigente {
  return {
    presentacionId: fila.presentacion_id,
    listaPrecioId: fila.lista_precio_id,
    // `numeric` de Postgres llega como cadena, no numero (mismo motivo que
    // `km_inicial` de vehiculo en T-11). `aNumero()` se importa de
    // sincronizacion/dinero.ts en vez de duplicarse.
    precio: aNumero(fila.precio) ?? 0,
    vigenteDesde: fila.vigente_desde,
  };
}

@Injectable()
export class PreciosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async listarListas(): Promise<ListaPrecio[]> {
    return this.db
      .selectFrom('lista_precio')
      .select(['id', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();
  }

  /**
   * El precio VIGENTE por presentacion x lista, para una sucursal: la fila con
   * `vigente_desde` mas reciente que no pase de hoy (D3 del spec). `DISTINCT
   * ON` de Postgres resuelve "la ultima fila por grupo" en una sola consulta,
   * sin traer el historial completo para filtrarlo en memoria -- Kysely no
   * tiene un helper propio para esto, asi que va en `sql` plano.
   *
   * Compara contra `current_date` de la BASE, no contra una fecha que calcule
   * el servidor de la app: es una comparacion `<=` tolerante, y Tijuana/
   * Mexicali estan detras de UTC, asi que la fecha local del navegador (la que
   * escribio el PATCH de la Task 3) nunca queda por delante de la fecha UTC
   * del servidor en el mismo instante.
   *
   * `p.vigente_desde::text`: sin el cast, el driver `pg` parsea una columna
   * `date` como un `Date` de JS a la medianoche LOCAL del proceso de Node, no
   * UTC. Volver a convertir ese `Date` a texto con `toISOString()` (que SI es
   * UTC) corre la fecha un dia hacia atras en cualquier maquina cuyo huso
   * horario este ADELANTE de UTC -- el entorno de desarrollo de este equipo
   * (Europe/Madrid) es exactamente ese caso. Mismo espiritu que `aNumero()`
   * en dinero.ts: no confiar en el parseo de tipos de `pg`, quedarse con el
   * texto que Postgres ya formateo bien.
   */
  async listarVigentes(sucursalCodigo: string): Promise<PrecioVigente[]> {
    const filas = await sql<FilaVigente>`
      select distinct on (p.presentacion_id, p.lista_precio_id)
        p.presentacion_id, p.lista_precio_id, p.precio,
        p.vigente_desde::text as vigente_desde
      from precio p
      join sucursal s on s.id = p.sucursal_id
      where s.codigo = ${sucursalCodigo}
        and p.deleted_at is null
        and p.vigente_desde <= current_date
      order by p.presentacion_id, p.lista_precio_id, p.vigente_desde desc
    `.execute(this.db);

    return filas.rows.map(aPrecioVigente);
  }

  /**
   * Upsert sobre `uq_precio_vigencia` (Task 1): si el admin ya edito esta
   * combinacion en la fecha que trae `datos.vigenteDesde`, corrige esa fila;
   * si no, abre un tramo nuevo de historia. El constraint es lo que hace esto
   * atomico sin un SELECT previo.
   *
   * Sin `.returning()`: no hace falta leer de vuelta lo que la base acaba de
   * guardar, porque ya lo conocemos -- son los mismos `datos` que mandamos.
   * Evita ademas tener que re-convertir un `vigente_desde` que volviera como
   * `Date` (ver el comentario de `listarVigentes` sobre el riesgo de huso
   * horario de `toISOString()`); aqui ese riesgo ni siquiera puede aparecer.
   */
  async upsert(datos: {
    presentacionId: string;
    listaPrecioId: string;
    sucursalId: string;
    precio: number;
    vigenteDesde: string;
  }): Promise<PrecioVigente> {
    await this.db
      .insertInto('precio')
      .values({
        presentacion_id: datos.presentacionId,
        lista_precio_id: datos.listaPrecioId,
        sucursal_id: datos.sucursalId,
        precio: datos.precio.toString(),
        vigente_desde: datos.vigenteDesde,
      })
      .onConflict((oc) =>
        oc
          .constraint('uq_precio_vigencia')
          .doUpdateSet({ precio: datos.precio.toString() }),
      )
      .executeTakeFirstOrThrow();

    return {
      presentacionId: datos.presentacionId,
      listaPrecioId: datos.listaPrecioId,
      precio: datos.precio,
      vigenteDesde: datos.vigenteDesde,
    };
  }

  /**
   * Delegado al helper compartido (D9 de T-12) -- el metodo se conserva para
   * no tocar `PreciosService`, que sigue llamando `this.repo.buscarSucursalUsuario(...)`.
   */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }
}
