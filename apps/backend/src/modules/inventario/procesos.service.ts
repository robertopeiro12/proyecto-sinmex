import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { PermisosRepository } from '../auth/permisos.repository';
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MOTIVO_PRESENTACION_INEXISTENTE,
} from '../produccion/reglas-comunes';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type {
  ConsultaProcesosDto,
  CrearProcesoDto,
  EditarProcesoDto,
} from './dto/proceso.dto';
import {
  ProcesosRepository,
  type FilaLineaProceso,
  type FilaProceso,
} from './procesos.repository';
import {
  validarProceso,
  type EntradaProcesoLimpia,
  type MermaDe,
  type Sentido,
  type TipoProceso,
} from './reglas-procesos';

export const MOTIVO_ELIGE_SUCURSAL = 'Elige una sucursal.';
export const MOTIVO_SUCURSAL_INEXISTENTE = 'No existe esa sucursal.';
export const MOTIVO_PROCESO_INEXISTENTE = 'No existe ese proceso.';
export const MOTIVO_CLIENTE_AJENO =
  'El cliente no existe o no es de esta sucursal.';
export const MOTIVO_VENDEDOR_AJENO =
  'El vendedor no existe o no es de esta sucursal.';
const MOTIVO_SIN_PERMISO = 'No tienes permiso para este tipo de proceso.';

export interface LineaProceso {
  presentacionId: string;
  /** "Horchata 500 ml". */
  nombre: string;
  sentido: Sentido;
  piezas: number;
}

/** Un proceso tal como lo recibe el portal. */
export interface Proceso {
  id: string;
  tipo: TipoProceso;
  fecha: string;
  /** `HH:MM` de Tijuana de la captura. */
  hora: string;
  mermaDe: MermaDe | null;
  cliente: { id: string; nombre: string } | null;
  /** null = Oficina. */
  vendedor: { id: string; nombre: string } | null;
  comentario: string | null;
  /** Nombre del usuario que lo capturo. */
  capturo: string;
  lineas: LineaProceso[];
  /** `updated_at` como ISO UTC con microsegundos. */
  actualizadoEn: string;
}

/** `GET /procesos`. */
export interface ProcesosDelDia {
  fecha: string;
  hoy: string;
  procesos: Proceso[];
}

/**
 * Operacion -> Procesos (PR A): merma, cambios, consumos, promocion y
 * descuentos que captura la oficina. Un solo recurso; el servicio exige el
 * permiso del tipo (`proceso.<tipo>`) en listar, crear, corregir y dar de baja.
 *
 * Alcance como el Registro de Operacion: un usuario atado solo registra en su
 * sucursal (pedir otra al listar o crear = 403; un proceso de otra sucursal =
 * 404); `todas` = 400.
 */
@Injectable()
export class ProcesosService {
  constructor(
    private readonly repo: ProcesosRepository,
    private readonly permisos: PermisosRepository,
  ) {}

  /** `GET /procesos`. */
  async listar(
    usuarioId: string,
    q: ConsultaProcesosDto,
  ): Promise<ProcesosDelDia> {
    await this.exigirPermiso(usuarioId, q.tipo);
    const hoy = await this.repo.hoyEnTijuana();
    if (!esFechaReal(q.fecha)) throw this.error400(MENSAJE_FECHA_INVALIDA, hoy);
    if (q.fecha > hoy) throw this.error400(MENSAJE_FECHA_FUTURA, hoy);
    const sucursal = await this.sucursalEnAlcance(usuarioId, q.sucursal);

    const filas = await this.repo.listar(
      sucursal.id,
      q.fecha,
      q.tipo,
      q.cliente ? q.cliente.toLowerCase() : null,
    );
    const lineas = await this.repo.lineasDe(filas.map((f) => f.id));
    return {
      fecha: q.fecha,
      hoy,
      procesos: filas.map((f) => this.armar(f, lineas)),
    };
  }

  /** `POST /procesos`. */
  async crear(usuarioId: string, dto: CrearProcesoDto): Promise<Proceso> {
    await this.exigirPermiso(usuarioId, dto.tipo);
    const hoy = await this.repo.hoyEnTijuana();
    const datos = this.validar(dto.tipo, dto, hoy);
    const sucursal = await this.sucursalEnAlcance(usuarioId, dto.sucursal);

    const id = await this.repo.enTransaccion(async (trx) => {
      await this.exigirReferencias(datos, sucursal.id, null, trx);
      await this.exigirPresentaciones(datos, new Set(), trx);
      const nuevo = await this.repo.insertar(
        sucursal.id,
        datos,
        usuarioId,
        trx,
      );
      await this.repo.reemplazarLineas(nuevo, datos.lineas, trx);
      return nuevo;
    });
    return this.armarConLineas((await this.repo.porId(id))!);
  }

  /** `PATCH /procesos/:id`: reemplaza los datos y las lineas (no el tipo ni la sucursal). */
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarProcesoDto,
  ): Promise<Proceso> {
    const previo = await this.propio(usuarioId, id);
    const hoy = await this.repo.hoyEnTijuana();
    const datos = this.validar(previo.tipo, dto, hoy);

    await this.repo.enTransaccion(async (trx) => {
      // El candado va primero y todo se relee bajo el: otra edicion o baja
      // simultanea no pisa esta.
      const fila = await this.repo.bloquear(id, trx);
      if (!fila) throw new NotFoundException(MOTIVO_PROCESO_INEXISTENTE);
      await this.exigirReferencias(datos, fila.sucursalId, fila, trx);
      await this.exigirPresentaciones(
        datos,
        await this.repo.idsPresentacionesDe(id, trx),
        trx,
      );
      await this.repo.actualizar(id, datos, usuarioId, trx);
      await this.repo.reemplazarLineas(id, datos.lineas, trx);
    });
    return this.armarConLineas((await this.repo.porId(id))!);
  }

  /** `DELETE /procesos/:id`: baja logica. */
  async eliminar(usuarioId: string, id: string): Promise<void> {
    await this.propio(usuarioId, id);
    await this.repo.enTransaccion(async (trx) => {
      const fila = await this.repo.bloquear(id, trx);
      if (!fila) throw new NotFoundException(MOTIVO_PROCESO_INEXISTENTE);
      await this.repo.darDeBaja(id, usuarioId, trx);
    });
  }

  // --- piezas internas -----------------------------------------------------

  private validar(
    tipo: TipoProceso,
    dto: EditarProcesoDto,
    hoy: string,
  ): EntradaProcesoLimpia {
    const r = validarProceso({
      tipo,
      fecha: dto.fecha,
      hoy,
      mermaDe: dto.mermaDe,
      clienteId: dto.clienteId,
      vendedorId: dto.vendedorId,
      comentario: dto.comentario,
      lineas: dto.lineas,
    });
    if (!r.ok) throw this.error400(r.error, hoy);
    return r.valor;
  }

  /**
   * Cliente y vendedor vivos y de la sucursal del proceso. Al corregir, el que
   * ya tenia el proceso se conserva aunque despues se haya dado de baja (como
   * las presentaciones): la pantalla reenvia lo que leyo.
   */
  private async exigirReferencias(
    datos: EntradaProcesoLimpia,
    sucursalId: string,
    actual: FilaProceso | null,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (
      datos.clienteId !== null &&
      datos.clienteId !== actual?.clienteId &&
      !(await this.repo.clienteDeSucursal(datos.clienteId, sucursalId, trx))
    )
      throw new BadRequestException(MOTIVO_CLIENTE_AJENO);
    if (
      datos.vendedorId !== null &&
      datos.vendedorId !== actual?.vendedorId &&
      !(await this.repo.vendedorDeSucursal(datos.vendedorId, sucursalId, trx))
    )
      throw new BadRequestException(MOTIVO_VENDEDOR_AJENO);
  }

  /**
   * Toda presentacion que no estaba ya en el proceso tiene que estar viva y
   * activa. Una que ya estaba pasa aunque ya no lo este.
   */
  private async exigirPresentaciones(
    datos: EntradaProcesoLimpia,
    yaEstaban: ReadonlySet<string>,
    trx: Transaction<DB>,
  ): Promise<void> {
    const porRevisar = [
      ...new Set(datos.lineas.map((l) => l.presentacionId)),
    ].filter((id) => !yaEstaban.has(id));
    const existen = await this.repo.idsPresentacionesActivas(porRevisar, trx);
    if (porRevisar.some((id) => !existen.has(id)))
      throw new BadRequestException(MOTIVO_PRESENTACION_INEXISTENTE);
  }

  /**
   * Un proceso vivo de la sucursal del usuario (otra o inexistente = el mismo
   * 404) y con el permiso de su tipo (403). El alcance va antes que el permiso:
   * no se le dice a nadie de un proceso ajeno.
   */
  private async propio(usuarioId: string, id: string): Promise<FilaProceso> {
    const usuario = await this.usuario(usuarioId);
    const fila = await this.repo.porId(id);
    if (
      !fila ||
      (usuario.codigo !== null && usuario.codigo !== fila.sucursalCodigo)
    )
      throw new NotFoundException(MOTIVO_PROCESO_INEXISTENTE);
    await this.exigirPermiso(usuarioId, fila.tipo);
    return fila;
  }

  private async exigirPermiso(
    usuarioId: string,
    tipo: TipoProceso,
  ): Promise<void> {
    const permisos = await this.permisos.permisosDe(usuarioId);
    if (!permisos.has(`proceso.${tipo}`))
      throw new ForbiddenException(MOTIVO_SIN_PERMISO);
  }

  private async armarConLineas(fila: FilaProceso): Promise<Proceso> {
    return this.armar(fila, await this.repo.lineasDe([fila.id]));
  }

  private armar(f: FilaProceso, todas: FilaLineaProceso[]): Proceso {
    return {
      id: f.id,
      tipo: f.tipo,
      fecha: f.fecha,
      hora: f.hora,
      mermaDe: f.mermaDe,
      cliente:
        f.clienteId !== null
          ? { id: f.clienteId, nombre: f.clienteNombre ?? '' }
          : null,
      vendedor:
        f.vendedorId !== null
          ? { id: f.vendedorId, nombre: f.vendedorNombre ?? '' }
          : null,
      comentario: f.comentario,
      capturo: f.capturo,
      lineas: todas
        .filter((l) => l.procesoId === f.id)
        .map((l) => ({
          presentacionId: l.presentacionId,
          nombre: l.nombre,
          sentido: l.sentido,
          piezas: l.piezas,
        })),
      actualizadoEn: f.actualizadoEn,
    };
  }

  /** 400 con el mensaje y el "hoy" de Tijuana (como el Registro de Operacion). */
  private error400(mensaje: string, hoy: string): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: [mensaje],
      hoyEnTijuana: hoy,
    });
  }

  private async usuario(usuarioId: string) {
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    return usuario;
  }

  /** La sucursal pedida por codigo: General elige una (`todas` = 400); atado, la suya (otra = 403). */
  private async sucursalEnAlcance(
    usuarioId: string,
    pedida: string | undefined,
  ) {
    const usuario = await this.usuario(usuarioId);
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(pedida),
    );
    if (alcance.tipo === 'todas')
      throw new BadRequestException(MOTIVO_ELIGE_SUCURSAL);
    const sucursal = await this.repo.sucursalPorCodigo(alcance.codigo);
    if (!sucursal) throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
    return sucursal;
  }
}
