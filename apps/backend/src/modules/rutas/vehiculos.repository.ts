import { Inject, Injectable } from '@nestjs/common';
import { DB_CONNECTION, type Database } from '../../database/database.tokens';
import { aNumero } from '../sincronizacion/dinero';
import { buscarSucursalUsuario as buscarSucursalUsuarioCompartido } from '../sucursales/buscar-sucursal-usuario';

export interface Vehiculo {
  id: string;
  nombre: string;
  kmInicial: number | null;
  sucursalId: string;
  sucursalCodigo: string;
  activo: boolean;
}

/**
 * `km_inicial` es `numeric`, y el driver `pg` lo devuelve como CADENA
 * ("1000.00"), no como numero -- ver `Numeric` en schema.d.ts. `aNumero()` es la
 * misma conversion que ya usa el pull de T-07 para lat/lng; se importa en vez de
 * duplicarse porque un segundo parser de numeros acaba divergiendo del primero.
 *
 * `deleted_at` no sale nunca a la API (convencion de T-09), asi que ni se
 * selecciona.
 */
function aVehiculo(fila: {
  id: string;
  nombre: string;
  km_inicial: string | null;
  sucursal_id: string;
  codigo: string;
  activo: boolean;
}): Vehiculo {
  return {
    id: fila.id,
    nombre: fila.nombre,
    kmInicial: aNumero(fila.km_inicial),
    sucursalId: fila.sucursal_id,
    sucursalCodigo: fila.codigo,
    activo: fila.activo,
  };
}

@Injectable()
export class VehiculosRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /**
   * El join a `sucursal` trae el codigo junto al id: la tabla del portal pinta
   * el codigo, y sin el haria una segunda peticion solo para traducir uuid ->
   * codigo.
   *
   * Devuelve activos E inactivos a proposito: la pantalla del catalogo necesita
   * ver un vehiculo desactivado para poder reactivarlo (mismo criterio que
   * SucursalesRepository.listar de T-09 y ProductosRepository.listar de T-10).
   */
  async listar(): Promise<Vehiculo[]> {
    const filas = await this.db
      .selectFrom('vehiculo')
      .innerJoin('sucursal', 'sucursal.id', 'vehiculo.sucursal_id')
      .select([
        'vehiculo.id',
        'vehiculo.nombre',
        'vehiculo.km_inicial',
        'vehiculo.sucursal_id',
        'sucursal.codigo',
        'vehiculo.activo',
      ])
      .where('vehiculo.deleted_at', 'is', null)
      .orderBy('sucursal.codigo')
      .orderBy('vehiculo.nombre')
      .execute();

    return filas.map(aVehiculo);
  }

  async listarPorCodigoSucursal(codigo: string): Promise<Vehiculo[]> {
    const filas = await this.db
      .selectFrom('vehiculo')
      .innerJoin('sucursal', 'sucursal.id', 'vehiculo.sucursal_id')
      .select([
        'vehiculo.id',
        'vehiculo.nombre',
        'vehiculo.km_inicial',
        'vehiculo.sucursal_id',
        'sucursal.codigo',
        'vehiculo.activo',
      ])
      .where('vehiculo.deleted_at', 'is', null)
      .where('sucursal.codigo', '=', codigo)
      .orderBy('vehiculo.nombre')
      .execute();

    return filas.map(aVehiculo);
  }

  /**
   * Sin transaccion: es un solo insert. La lectura del codigo de sucursal va
   * despues porque `returning` no puede traer columnas de la tabla del join.
   */
  async crear(
    nombre: string,
    kmInicial: number,
    sucursalId: string,
  ): Promise<Vehiculo> {
    const fila = await this.db
      .insertInto('vehiculo')
      .values({ nombre, km_inicial: kmInicial, sucursal_id: sucursalId })
      .returning(['id', 'nombre', 'km_inicial', 'sucursal_id', 'activo'])
      .executeTakeFirstOrThrow();

    const sucursal = await this.db
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', sucursalId)
      .executeTakeFirstOrThrow();

    return aVehiculo({ ...fila, codigo: sucursal.codigo });
  }

  async buscarPorId(id: string): Promise<Vehiculo | undefined> {
    const fila = await this.db
      .selectFrom('vehiculo')
      .innerJoin('sucursal', 'sucursal.id', 'vehiculo.sucursal_id')
      .select([
        'vehiculo.id',
        'vehiculo.nombre',
        'vehiculo.km_inicial',
        'vehiculo.sucursal_id',
        'sucursal.codigo',
        'vehiculo.activo',
      ])
      .where('vehiculo.id', '=', id)
      .where('vehiculo.deleted_at', 'is', null)
      .executeTakeFirst();

    return fila ? aVehiculo(fila) : undefined;
  }

  /**
   * `cambios` nunca llega vacio: el servicio lo comprueba antes. Un `.set({})`
   * genera SQL invalido, asi que el chequeo no es cortesia, es necesario.
   *
   * La sucursal no se toca (D3), asi que el codigo se lee de la fila que ya
   * existe y no hace falta un segundo join en el `returning`.
   */
  async actualizar(
    id: string,
    cambios: { nombre?: string; km_inicial?: number; activo?: boolean },
  ): Promise<Vehiculo> {
    const fila = await this.db
      .updateTable('vehiculo')
      .set(cambios)
      .where('id', '=', id)
      .returning(['id', 'nombre', 'km_inicial', 'sucursal_id', 'activo'])
      .executeTakeFirstOrThrow();

    const sucursal = await this.db
      .selectFrom('sucursal')
      .select('codigo')
      .where('id', '=', fila.sucursal_id)
      .executeTakeFirstOrThrow();

    return aVehiculo({ ...fila, codigo: sucursal.codigo });
  }

  /**
   * Delegado al helper compartido (D9 de T-12) -- el metodo se conserva para
   * no tocar `VehiculosService`, que sigue llamando `this.repo.buscarSucursalUsuario(...)`.
   */
  async buscarSucursalUsuario(
    usuarioId: string,
  ): Promise<{ id: string | null; codigo: string | null } | undefined> {
    return buscarSucursalUsuarioCompartido(this.db, usuarioId);
  }
}
