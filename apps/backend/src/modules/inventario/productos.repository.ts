import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import type { PlanPresentaciones } from './reconciliar-presentaciones';

export interface Presentacion {
  id: string;
  volumen: string;
}

export interface Producto {
  id: string;
  nombre: string;
  activo: boolean;
  presentaciones: Presentacion[];
}

@Injectable()
export class ProductosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Devuelve productos activos E inactivos: la pantalla del catalogo necesita
   * ver uno desactivado para poder reactivarlo (mismo criterio que
   * SucursalesRepository.listar de T-09). Las presentaciones dadas de baja NO
   * vuelven: su baja es `deleted_at` y esa si es definitiva (D1).
   *
   * Sin filtro por sucursal a proposito: el catalogo de sabores es de la
   * empresa, lo que varia por sucursal es el precio (D4).
   */
  async listar(): Promise<Producto[]> {
    const productos = await this.db
      .selectFrom('producto')
      .select(['id', 'nombre', 'activo'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .execute();

    if (productos.length === 0) return [];

    const presentaciones = await this.db
      .selectFrom('presentacion')
      .select(['id', 'producto_id', 'volumen'])
      .where('deleted_at', 'is', null)
      .where(
        'producto_id',
        'in',
        productos.map((p) => p.id),
      )
      .orderBy('volumen')
      .execute();

    // Una sola consulta para todas las presentaciones y se agrupan en memoria:
    // son decenas de filas, no vale la pena una consulta por producto.
    const porProducto = new Map<string, Presentacion[]>();
    for (const fila of presentaciones) {
      const lista = porProducto.get(fila.producto_id) ?? [];
      lista.push({ id: fila.id, volumen: fila.volumen });
      porProducto.set(fila.producto_id, lista);
    }

    return productos.map((p) => ({
      ...p,
      presentaciones: porProducto.get(p.id) ?? [],
    }));
  }

  async buscarPorId(id: string): Promise<Producto | undefined> {
    const producto = await this.db
      .selectFrom('producto')
      .select(['id', 'nombre', 'activo'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!producto) return undefined;

    const presentaciones = await this.db
      .selectFrom('presentacion')
      .select(['id', 'volumen'])
      .where('producto_id', '=', id)
      .where('deleted_at', 'is', null)
      .orderBy('volumen')
      .execute();

    return { ...producto, presentaciones };
  }

  /**
   * Primera transaccion del backend. El producto y sus presentaciones entran
   * juntos o no entra ninguno: un producto sin presentaciones no se puede
   * vender ni poner precio (D7, D8).
   */
  async crear(nombre: string, volumenes: string[]): Promise<Producto> {
    return this.db.transaction().execute(async (trx) => {
      const producto = await trx
        .insertInto('producto')
        .values({ nombre })
        .returning(['id', 'nombre', 'activo'])
        .executeTakeFirstOrThrow();

      const presentaciones = await trx
        .insertInto('presentacion')
        .values(
          volumenes.map((volumen) => ({ producto_id: producto.id, volumen })),
        )
        .returning(['id', 'volumen'])
        .execute();

      return { ...producto, presentaciones };
    });
  }

  /**
   * Aplica el plan que calculo `reconciliarPresentaciones` mas los cambios del
   * producto, todo en una transaccion (D7): si una presentacion revienta por
   * el unique, no puede quedar el nombre cambiado y las filas a medias.
   */
  async actualizar(
    id: string,
    cambios: { nombre: string; activo?: boolean },
    plan: PlanPresentaciones,
  ): Promise<Producto> {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('producto')
        .set(cambios)
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      if (plan.darDeBaja.length > 0) {
        // Baja logica, nunca `delete` (D1): un borrado fisico desaparece del
        // pull incremental y la tablet se queda la fila para siempre.
        //
        // Va ANTES que los renombres y las altas: un volumen que se libera
        // aqui puede ser justo el que un renombre o una insercion de este
        // mismo guardado quiere ocupar, y el indice unico solo ignora las
        // filas con `deleted_at` ya puesto.
        await trx
          .updateTable('presentacion')
          .set({ deleted_at: new Date() })
          .where('id', 'in', plan.darDeBaja)
          .execute();
      }

      for (const fila of plan.actualizar) {
        await trx
          .updateTable('presentacion')
          .set({ volumen: fila.volumen })
          .where('id', '=', fila.id)
          .execute();
      }

      if (plan.insertar.length > 0) {
        await trx
          .insertInto('presentacion')
          .values(
            plan.insertar.map((p) => ({ producto_id: id, volumen: p.volumen })),
          )
          .execute();
      }

      const producto = await trx
        .selectFrom('producto')
        .select(['id', 'nombre', 'activo'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      const presentaciones = await trx
        .selectFrom('presentacion')
        .select(['id', 'volumen'])
        .where('producto_id', '=', id)
        .where('deleted_at', 'is', null)
        .orderBy('volumen')
        .execute();

      return { ...producto, presentaciones };
    });
  }
}
