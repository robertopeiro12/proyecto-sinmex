import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';

export interface Vendedor {
  id: string;
  nombre: string;
  login: string;
  sucursalId: string;
  sucursalCodigo: string;
  folioSegmento: string | null;
  activo: boolean;
}

/** `deleted_at` y `password_hash` nunca salen a la API (misma convencion que T-09/T-13). */
function aVendedor(fila: {
  id: string;
  nombre: string;
  login: string;
  sucursal_id: string;
  codigo: string;
  folio_segmento: string | null;
  activo: boolean;
}): Vendedor {
  return {
    id: fila.id,
    nombre: fila.nombre,
    login: fila.login,
    sucursalId: fila.sucursal_id,
    sucursalCodigo: fila.codigo,
    folioSegmento: fila.folio_segmento,
    activo: fila.activo,
  };
}

const COLUMNAS = [
  'vendedor.id',
  'vendedor.nombre',
  'vendedor.login',
  'vendedor.sucursal_id',
  'sucursal.codigo',
  'vendedor.folio_segmento',
  'vendedor.activo',
] as const;

@Injectable()
export class VendedoresRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * Devuelve activos E inactivos: la pantalla del catalogo necesita ver un
   * vendedor desactivado (mismo criterio que Sucursales/Productos/Vehiculos).
   */
  async listar(): Promise<Vendedor[]> {
    const filas = await this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select(COLUMNAS)
      .where('vendedor.deleted_at', 'is', null)
      .orderBy('sucursal.codigo')
      .orderBy('vendedor.nombre')
      .execute();

    return filas.map(aVendedor);
  }

  async listarPorCodigoSucursal(codigo: string): Promise<Vendedor[]> {
    const filas = await this.db
      .selectFrom('vendedor')
      .innerJoin('sucursal', 'sucursal.id', 'vendedor.sucursal_id')
      .select(COLUMNAS)
      .where('vendedor.deleted_at', 'is', null)
      .where('sucursal.codigo', '=', codigo)
      .orderBy('vendedor.nombre')
      .execute();

    return filas.map(aVendedor);
  }

  /**
   * Sin transaccion: es un solo insert. La lectura del codigo de sucursal va
   * despues porque `returning` no puede traer columnas de la tabla del join.
   */
  async crear(datos: {
    nombre: string;
    login: string;
    passwordHash: string;
    sucursalId: string;
    folioSegmento: string;
  }): Promise<Vendedor> {
    const fila = await this.db
      .insertInto('vendedor')
      .values({
        nombre: datos.nombre,
        login: datos.login,
        password_hash: datos.passwordHash,
        sucursal_id: datos.sucursalId,
        folio_segmento: datos.folioSegmento,
      })
      .returning([
        'id',
        'nombre',
        'login',
        'sucursal_id',
        'folio_segmento',
        'activo',
      ])
      .executeTakeFirstOrThrow();

    const sucursal = await this.db
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', datos.sucursalId)
      .executeTakeFirstOrThrow();

    return aVendedor({ ...fila, codigo: sucursal.codigo });
  }

  /**
   * Delegado al helper compartido de T-12 (D9 del spec) -- NO se duplica
   * aqui: `VehiculosRepository`, `ClientesRepository` y `PreciosRepository`
   * ya lo usan tal cual.
   */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }
}
