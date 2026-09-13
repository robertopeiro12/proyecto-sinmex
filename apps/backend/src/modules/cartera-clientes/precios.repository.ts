import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aCentavos, aNumero } from '../sincronizacion/dinero';
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
   * Presentaciones que se le pueden vender a un cliente en `fecha`, con su
   * precio vigente en centavos o `null` si no tiene ninguno (T-16).
   *
   * Es lo que usa `VentasService` para decidir si una venta de la tablet se
   * aplica: una presentacion que no esta en el mapa ya no se vende
   * (`presentacion-inactiva`), y una con `null` solo se puede regalar como
   * promocion (`precio-no-asignado` si la linea trae cantidad).
   *
   * > [!danger] Tiene que dar el MISMO precio que baja en el `pull`
   * > Resuelve igual que `SincronizacionRepository.precios()`: el registro
   * > vigente mas reciente de la lista del cliente para su sucursal, y el
   * > override del cliente encima **solo si la lista tiene precio** para esa
   * > presentacion (el `pull` hace el mismo `left join` desde la lista). Si las
   * > dos consultas divergieran, la tablet cobraria con un precio que el
   * > servidor no reconoce. Un e2e las compara.
   *
   * La fecha es `fecha_operacion` tal cual llego de la tablet, nunca el reloj
   * del servidor. Sin opciones resuelve exactamente a esa fecha, igual que el
   * `pull` (es lo que compara el e2e de paridad).
   *
   * `vigenteHastaHoy` es para la comprobacion de EXISTENCIA de una venta
   * (enmienda de D12): mide a `greatest(fecha, current_date)`, asi que cuenta
   * tambien los precios asignados despues de la venta, hasta hoy. El portal
   * siempre da de alta los precios con vigencia desde hoy; sin esto, una venta
   * de ayer rechazada por `precio-no-asignado` no se recuperaria nunca aunque
   * el admin asigne el precio. `current_date` es solo un tope para la
   * existencia: la fecha de la venta no cambia, y el valor que devuelve en ese
   * modo no se usa para cobrar (D2, vale el precio de la tablet). Se calcula en
   * Postgres y no en Node: `current_date` (UTC) nunca va detras de la fecha de
   * Tijuana, y el huso del proceso de Node no importa.
   *
   * Recibe la conexion en `trx` porque `push` la llama dentro de la transaccion
   * de la operacion (ADR-0009); cualquier `Kysely<DB>` sirve, y una
   * `Transaction<DB>` lo es.
   */
  async presentacionesConPrecio(
    clienteId: string,
    fecha: string,
    trx: Database,
    opciones: { vigenteHastaHoy?: boolean } = {},
  ): Promise<Map<string, number | null>> {
    const corte = opciones.vigenteHastaHoy
      ? sql`greatest(${fecha}::date, current_date)`
      : sql`${fecha}::date`;

    const filas = await sql<{
      presentacion_id: string;
      precio: string | null;
    }>`
      with cli as (
        select lista_precio_id, sucursal_id
          from cliente
         where id = ${clienteId}
      ),
      vigente_lista as (
        select distinct on (p.presentacion_id) p.presentacion_id, p.precio
          from precio p
          join cli on cli.lista_precio_id = p.lista_precio_id
                  and cli.sucursal_id = p.sucursal_id
         where p.deleted_at is null
           and p.vigente_desde <= ${corte}
         order by p.presentacion_id, p.vigente_desde desc
      ),
      vigente_cliente as (
        select distinct on (cp.presentacion_id) cp.presentacion_id, cp.precio
          from cliente_precio cp
         where cp.cliente_id = ${clienteId}
           and cp.deleted_at is null
           and cp.vigente_desde <= ${corte}
         order by cp.presentacion_id, cp.vigente_desde desc
      )
      select pr.id as presentacion_id,
             case when vl.presentacion_id is null then null
                  else coalesce(vc.precio, vl.precio)
             end as precio
        from presentacion pr
        join producto prod on prod.id = pr.producto_id
        left join vigente_lista vl on vl.presentacion_id = pr.id
        left join vigente_cliente vc on vc.presentacion_id = pr.id
       where pr.deleted_at is null
         and prod.deleted_at is null
         and prod.activo
    `.execute(trx);

    return new Map<string, number | null>(
      filas.rows.map((f): [string, number | null] => [
        f.presentacion_id,
        f.precio === null ? null : aCentavos(f.precio),
      ]),
    );
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
