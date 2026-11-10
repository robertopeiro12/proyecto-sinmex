import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import {
  normalizarSucursalPedida,
  resolverAlcance,
  type Alcance,
} from '../sucursales/alcance-sucursal';
import type {
  CrearRutaSemanalDto,
  GuardarClientesRutaSemanalDto,
  RenombrarRutaSemanalDto,
} from './dto/ruta-semanal.dto';
import {
  fechaLarga,
  nombreDia,
  planearPropagacion,
} from './reglas-ruta-semanal';
import { RELOJ_RUTAS, type RelojRutas } from './reloj';
import { RutasDiariasRepository } from './rutas-diarias.repository';
import {
  MOTIVO_CLIENTE_REPETIDO,
  motivoClientesNoValidos,
} from './rutas-diarias.service';
import {
  RutasSemanalesRepository,
  type FilaRutaSemanal,
} from './rutas-semanales.repository';

/** Un renglon de la lista de Ruta Semanal (todas las de la sucursal, de lunes a sabado). */
export interface RutaSemanalResumen {
  id: string;
  diaSemana: number;
  nombre: string;
  clientes: number;
  sucursalCodigo: string;
}

/** `valido = false`: dado de baja, vuelto prospecto o de otra sucursal. No se copia a la ruta del dia. */
export interface ClienteDeRutaSemanal {
  clienteId: string;
  nombre: string;
  valido: boolean;
}

export interface RutaSemanalDetalle extends RutaSemanalResumen {
  lista: ClienteDeRutaSemanal[];
}

export const MOTIVO_ELIGE_SUCURSAL = 'Elige una sucursal.';
export const MOTIVO_RUTA_INEXISTENTE = 'No existe esa ruta.';

function nombreRepetido(diaSemana: number): ConflictException {
  return new ConflictException(
    `Ya hay una ruta con ese nombre el ${nombreDia(diaSemana)}.`,
  );
}

/**
 * La Ruta Semanal del portal: rutas con nombre por dia de la semana y
 * sucursal, y su propagacion a las rutas del dia ya armadas (spec §4).
 *
 * Candados, siempre en este orden (el mismo que la ruta diaria): la fila de la
 * `ruta_semanal` y despues la de cada `vendedor`, por id.
 */
@Injectable()
export class RutasSemanalesService {
  constructor(
    private readonly repo: RutasSemanalesRepository,
    private readonly diarias: RutasDiariasRepository,
    @Inject(RELOJ_RUTAS) private readonly reloj: RelojRutas,
  ) {}

  /** "Hoy" de Tijuana, nunca el de UTC. */
  private hoy(): string {
    return hoyEnTijuana(this.reloj());
  }

  /** `GET /rutas/semanales`. */
  async listar(
    usuarioId: string,
    sucursal: string | undefined,
  ): Promise<RutaSemanalResumen[]> {
    const codigo = await this.sucursalDeTrabajo(usuarioId, sucursal);
    const filas = await this.repo.listar(codigo);
    return filas.map((f) => this.resumen(f, f.clientes));
  }

  /** `POST /rutas/semanales`. El duplicado lo decide el indice unico, no una consulta previa. */
  async crear(
    usuarioId: string,
    dto: CrearRutaSemanalDto,
  ): Promise<RutaSemanalDetalle> {
    const codigo = await this.sucursalDeTrabajo(usuarioId, dto.sucursal);
    const sucursalId = await this.repo.sucursalPorCodigo(codigo);
    if (!sucursalId) throw new BadRequestException('No existe esa sucursal.');
    let id: string;
    try {
      id = await this.repo.crear(sucursalId, dto.diaSemana, dto.nombre);
    } catch (error) {
      if (esViolacionUnicidad(error)) throw nombreRepetido(dto.diaSemana);
      throw error;
    }
    return this.obtener(usuarioId, id);
  }

  /** `GET /rutas/semanales/:id`. */
  async obtener(usuarioId: string, id: string): Promise<RutaSemanalDetalle> {
    const ruta = await this.rutaEnAlcance(usuarioId, id);
    return this.detalle(ruta);
  }

  /**
   * `PATCH /rutas/semanales/:id`: el nombre, y el `nombre_ruta` de sus rutas
   * del dia de hoy en adelante (las pasadas conservan el que tenian).
   */
  async renombrar(
    usuarioId: string,
    id: string,
    dto: RenombrarRutaSemanalDto,
  ): Promise<RutaSemanalDetalle> {
    const ruta = await this.rutaEnAlcance(usuarioId, id);
    try {
      await this.repo.enTransaccion(async (trx) => {
        if (!(await this.repo.buscar(ruta.id, trx))) {
          throw new NotFoundException(MOTIVO_RUTA_INEXISTENTE);
        }
        await this.repo.renombrar(ruta.id, dto.nombre, trx);
        await this.repo.renombrarRutasDelDia(
          ruta.id,
          dto.nombre,
          this.hoy(),
          trx,
        );
      });
    } catch (error) {
      if (esViolacionUnicidad(error)) throw nombreRepetido(ruta.diaSemana);
      throw error;
    }
    return this.obtener(usuarioId, ruta.id);
  }

  /**
   * `PUT /rutas/semanales/:id/clientes`: reemplaza la lista y la propaga, en la
   * MISMA transaccion, a cada ruta del dia viva de esta ruta con fecha de hoy
   * (Tijuana) en adelante (`planearPropagacion`). Solo se validan los clientes
   * NUEVOS: uno que ya estaba y dejo de valer no bloquea el guardado.
   */
  async guardarClientes(
    usuarioId: string,
    id: string,
    dto: GuardarClientesRutaSemanalDto,
  ): Promise<RutaSemanalDetalle> {
    const clientes = dto.clientes.map((c) => c.toLowerCase());
    if (new Set(clientes).size !== clientes.length) {
      throw new BadRequestException(MOTIVO_CLIENTE_REPETIDO);
    }
    const enAlcance = await this.rutaEnAlcance(usuarioId, id);

    await this.repo.enTransaccion(async (trx) => {
      // 1. La ruta semanal: serializa dos guardados de la misma ruta.
      const ruta = await this.repo.buscar(enAlcance.id, trx);
      if (!ruta) throw new NotFoundException(MOTIVO_RUTA_INEXISTENTE);

      const actuales = await this.repo.filasDeLista(ruta.id, trx);
      const antes = new Set(actuales.map((f) => f.clienteId));
      const agregados = clientes.filter((c) => !antes.has(c));
      const ahora = new Set(clientes);
      const quitados = new Set([...antes].filter((c) => !ahora.has(c)));

      const validos = await this.diarias.clientesParaRuta(
        agregados,
        ruta.sucursalId,
        trx,
      );
      const invalidos = agregados.filter((c) => !validos.has(c));
      if (invalidos.length > 0) {
        const nombres = await this.diarias.nombresDeClientes(
          invalidos,
          ruta.sucursalId,
          trx,
        );
        throw new BadRequestException(
          motivoClientesNoValidos(invalidos.map((c) => nombres.get(c) ?? c)),
        );
      }

      await this.repo.reemplazarLista(ruta.id, actuales, clientes, trx);

      if (agregados.length === 0 && quitados.size === 0) return;

      // 2. Cada vendedor, en orden de id (lo da la consulta): las rutas del
      // dia se leen despues de su candado.
      const asignadas = await this.repo.asignadasDesde(
        ruta.id,
        this.hoy(),
        trx,
      );
      for (const dia of asignadas) {
        await this.diarias.bloquearVendedor(dia.vendedorId, trx);
        const vivas = await this.diarias.filasVivas(
          dia.vendedorId,
          dia.fecha,
          trx,
        );
        const aMano = await this.repo.quitadosAMano(
          dia.vendedorId,
          dia.fecha,
          trx,
        );
        const plan = planearPropagacion(
          vivas,
          agregados,
          quitados,
          aMano,
          validos,
        );
        await this.repo.aplicarPropagacion(
          dia.vendedorId,
          dia.fecha,
          plan,
          trx,
        );
        await this.repo.quitarNotasAsignadas(
          dia.vendedorId,
          dia.fecha,
          plan.borrar.map((f) => f.clienteId),
          usuarioId,
          trx,
        );
      }
    });

    return this.obtener(usuarioId, enAlcance.id);
  }

  /**
   * `DELETE /rutas/semanales/:id`: baja logica. No se puede si esta asignada a
   * un vendedor hoy (Tijuana) o un dia futuro; las rutas del dia pasadas
   * conservan su `nombre_ruta`.
   */
  async eliminar(usuarioId: string, id: string): Promise<void> {
    const enAlcance = await this.rutaEnAlcance(usuarioId, id);
    await this.repo.enTransaccion(async (trx) => {
      const ruta = await this.repo.buscar(enAlcance.id, trx);
      if (!ruta) throw new NotFoundException(MOTIVO_RUTA_INEXISTENTE);
      const asignadas = await this.repo.asignadasDesde(
        ruta.id,
        this.hoy(),
        trx,
      );
      if (asignadas.length > 0) {
        const primera = asignadas.reduce((a, b) => (b.fecha < a.fecha ? b : a));
        throw new ConflictException(
          `Esta ruta está asignada a ${primera.vendedorNombre} el ${fechaLarga(primera.fecha)}.`,
        );
      }
      await this.repo.darDeBaja(ruta.id, trx);
    });
  }

  private resumen(ruta: FilaRutaSemanal, clientes: number): RutaSemanalResumen {
    return {
      id: ruta.id,
      diaSemana: ruta.diaSemana,
      nombre: ruta.nombre,
      clientes,
      sucursalCodigo: ruta.sucursalCodigo,
    };
  }

  private async detalle(ruta: FilaRutaSemanal): Promise<RutaSemanalDetalle> {
    const lista = await this.repo.lista(ruta);
    return { ...this.resumen(ruta, lista.length), lista };
  }

  private async alcanceDe(
    usuarioId: string,
    sucursal: string | null,
  ): Promise<Alcance> {
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    return resolverAlcance(usuario.codigo, sucursal);
  }

  /** La sucursal en la que se trabaja: con "Todas", 400 "Elige una sucursal.". */
  private async sucursalDeTrabajo(
    usuarioId: string,
    sucursal: string | undefined,
  ): Promise<string> {
    const alcance = await this.alcanceDe(
      usuarioId,
      normalizarSucursalPedida(sucursal),
    );
    if (alcance.tipo === 'todas') {
      throw new BadRequestException(MOTIVO_ELIGE_SUCURSAL);
    }
    return alcance.codigo;
  }

  /**
   * La ruta viva, si el usuario la alcanza. **404 y no 403** con otra
   * sucursal: no se confirma que exista (como `vendedorEnAlcance`).
   */
  private async rutaEnAlcance(
    usuarioId: string,
    id: string,
  ): Promise<FilaRutaSemanal> {
    const alcance = await this.alcanceDe(usuarioId, null);
    const ruta = await this.repo.buscar(id.toLowerCase());
    if (
      !ruta ||
      (alcance.tipo === 'una' && alcance.codigo !== ruta.sucursalCodigo)
    ) {
      throw new NotFoundException(MOTIVO_RUTA_INEXISTENTE);
    }
    return ruta;
  }
}
