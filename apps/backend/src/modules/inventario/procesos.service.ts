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
import { PromocionesService } from '../cartera-clientes/promociones.service';
import { movimientosDelDia } from '../produccion/cortes.repository';
import { CortesService } from '../produccion/cortes.service';
import type { ConsultaCorteVendedorDto } from '../produccion/dto/corte.dto';
import { NotasRutaRepository } from '../rutas/notas-ruta.repository';
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
  TIPOS_PROCESO,
  precargaPorTamano,
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
export const MOTIVO_CLIENTE_INEXISTENTE = 'No existe ese cliente.';
const MOTIVO_SIN_PERMISO = 'No tienes permiso para este tipo de proceso.';
const MOTIVO_SIN_PERMISO_PROCESOS = 'No tienes permiso para Procesos.';

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
 * `GET /procesos/descuentos/precarga`: los faltantes de piezas del corte de un
 * vendedor y dia, para precargar un descuento. Sin corte hecho, `lineas` vacio.
 */
export interface PrecargaDescuentos {
  corteHecho: boolean;
  /**
   * Lo que el corte dice que falta, por tamano (`precargaPorTamano`): lo que
   * sobra de un sabor tapa lo que falta de otro del mismo tamano. Orden del corte.
   */
  lineas: { presentacionId: string; nombre: string; piezas: number }[];
}

/** `GET /procesos/cliente/:id`: lo que la oficina ve del cliente al capturar. */
export interface ResumenCliente {
  id: string;
  nombre: string;
  tipo: 'cliente' | 'prospecto';
  tipoNegocio: string | null;
  diasCredito: number | null;
  /** Saldo de sus notas con saldo (la regla de `NotasRutaRepository.notasConSaldo`). */
  deudaCentavos: number;
  notasConSaldo: number;
  /** `AAAA-MM-DD` de su venta viva mas reciente. */
  ultimaCompra: string | null;
  /** Frases de las promociones vigentes (`textoPromocion`), propias primero. */
  promociones: string[];
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
    private readonly cortes: CortesService,
    private readonly notasRuta: NotasRutaRepository,
    private readonly promociones: PromocionesService,
  ) {}

  /**
   * `GET /procesos/descuentos/precarga`: lee el corte ya calculado
   * (`CortesService.leer`, misma fecha, alcance y 404 de vendedor ajeno o dado
   * de baja) y no recalcula la teorica; reparte el faltante por tamano con la
   * regla del corte (`precargaPorTamano`): la suma = `totales.faltante`.
   */
  async precargaDescuentos(
    usuarioId: string,
    q: ConsultaCorteVendedorDto,
  ): Promise<PrecargaDescuentos> {
    await this.exigirPermiso(usuarioId, 'descuento');
    const corte = await this.cortes.leer(usuarioId, q);
    if (corte.hecho === null) return { corteHecho: false, lineas: [] };
    return {
      corteHecho: true,
      lineas: precargaPorTamano(corte.lineas),
    };
  }

  /**
   * `GET /procesos/cliente/:id` (cualquiera de los cinco permisos): ficha corta
   * del cliente. Otra sucursal, dado de baja o inexistente = el mismo 404.
   */
  async resumenCliente(
    usuarioId: string,
    clienteId: string,
  ): Promise<ResumenCliente> {
    const permisos = await this.permisos.permisosDe(usuarioId);
    if (!TIPOS_PROCESO.some((t) => permisos.has(`proceso.${t}`)))
      throw new ForbiddenException(MOTIVO_SIN_PERMISO_PROCESOS);
    const usuario = await this.usuario(usuarioId);
    const id = clienteId.toLowerCase();
    const cliente = await this.repo.clienteResumen(id);
    if (
      !cliente ||
      (usuario.codigo !== null && usuario.codigo !== cliente.sucursalCodigo)
    )
      throw new NotFoundException(MOTIVO_CLIENTE_INEXISTENTE);
    const hoy = await this.repo.hoyEnTijuana();
    const [notas, promociones] = await Promise.all([
      this.notasRuta.notasConSaldo([id], hoy),
      this.promociones.vigentesDeCliente(id),
    ]);
    return {
      id: cliente.id,
      nombre: cliente.nombre,
      tipo: cliente.tipo,
      tipoNegocio: cliente.tipoNegocio,
      diasCredito: cliente.diasCredito,
      deudaCentavos: notas.reduce((t, n) => t + n.saldoCentavos, 0),
      notasConSaldo: notas.length,
      ultimaCompra: cliente.ultimaCompra,
      promociones,
    };
  }

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
   * activa. Una que ya estaba pasa aunque ya no lo este. En un descuento
   * tambien pasa una desactivada o dada de baja que tuvo movimiento en el corte
   * de ese vendedor y dia (el mismo criterio del corte, D13): la precarga la
   * trae del corte y el guardado no la debe rechazar.
   */
  private async exigirPresentaciones(
    datos: EntradaProcesoLimpia,
    yaEstaban: ReadonlySet<string>,
    trx: Transaction<DB>,
  ): Promise<void> {
    let porRevisar = [
      ...new Set(datos.lineas.map((l) => l.presentacionId)),
    ].filter((id) => !yaEstaban.has(id));
    if (porRevisar.length === 0) return;
    if (datos.tipo === 'descuento' && datos.vendedorId !== null) {
      const delCorte = new Set(
        (
          await movimientosDelDia(trx, datos.fecha, {
            vendedorId: datos.vendedorId,
          })
        ).map((m) => m.presentacionId),
      );
      porRevisar = porRevisar.filter((id) => !delCorte.has(id));
    }
    const existen = await this.repo.idsPresentacionesActivas(porRevisar, trx);
    const rechazada = porRevisar.find((id) => !existen.has(id));
    if (rechazada === undefined) return;
    const nombre = (
      await this.repo.nombresDePresentaciones([rechazada], trx)
    ).get(rechazada);
    throw new BadRequestException(
      nombre === undefined
        ? MOTIVO_PRESENTACION_INEXISTENTE
        : `La presentación ${nombre} está dada de baja o desactivada.`,
    );
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
