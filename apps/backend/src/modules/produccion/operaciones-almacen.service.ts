import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { PermisosRepository } from '../auth/permisos.repository';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type {
  ConsultaOperacionesDto,
  CrearOperacionDto,
  EditarOperacionDto,
} from './dto/operacion-almacen.dto';
import {
  OperacionesAlmacenRepository,
  type DatosOperacion,
  type FilaOperacion,
  type LineaOperacion,
} from './operaciones-almacen.repository';
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MOTIVO_PRESENTACION_INEXISTENTE,
} from './reglas-comunes';
import {
  fechaPermitida,
  mensajeRetiroNoPendiente,
  MENSAJE_RETIRO_AUTORIZADO,
  planLineas,
  retiroEditable,
  retiroResoluble,
  validarMotivoRechazo,
  type EstadoRetiro,
  validarOperacion,
  type LineaPedida,
  type TipoOperacion,
} from './reglas-operacion';

export const MOTIVO_ELIGE_SUCURSAL = 'Elige una sucursal.';
export const MOTIVO_SUCURSAL_INEXISTENTE = 'No existe esa sucursal.';
export const MOTIVO_DESTINO_INEXISTENTE = 'No existe la sucursal de destino.';
export const MOTIVO_OPERACION_INEXISTENTE = 'No existe esa operación.';
export const MOTIVO_MOTIVO_MERMA =
  'El motivo de la merma no existe o no aplica al almacén.';
export const MOTIVO_ENVIO_CERRADO =
  'Un envío solo se puede corregir o dar de baja el día que se hizo o el siguiente.';
export const MENSAJE_RETIRO_CAMBIO =
  'El retiro cambió desde que lo viste; revisa la cantidad nueva.';
const MOTIVO_SIN_PERMISO = 'No tienes permiso para este tipo de operación.';

/** Una operacion tal como la recibe el portal. */
export interface OperacionAlmacen {
  id: string;
  tipo: TipoOperacion;
  sucursal: { id: string; codigo: string };
  fecha: string;
  origen: 'produccion' | 'compra' | null;
  destino: { id: string; codigo: string } | null;
  motivo: { id: string; nombre: string } | null;
  trabajador: string | null;
  comentario: string | null;
  lineas: {
    presentacionId: string;
    nombre: string;
    producto: string;
    volumen: string;
    piezas: number;
  }[];
  piezas: number;
  capturo: string;
  /** `HH:MM` de Tijuana de la captura. */
  hora: string;
  /** Solo `retiro_merma`: pendiente, autorizado o rechazado (null en los demas tipos). */
  estado: EstadoRetiro | null;
  /** Quien autorizo o rechazo (`en` = `AAAA-MM-DD HH24:MI` de Tijuana); null si sigue pendiente. */
  resolucion: { por: string; en: string; motivo: string | null } | null;
  /**
   * Marca de la version de la fila (`updated_at`, ISO UTC con microsegundos,
   * exacto): Autorizar y Rechazar la devuelven para decir que version vieron.
   */
  actualizadoEn: string;
  /** Se puede corregir o dar de baja (fecha dentro de su regla y no es un envio visto desde el destino). */
  editable: boolean;
  /** Un envio visto en Entradas del destino: solo lectura ahi. */
  envio: { origen: { id: string; codigo: string } } | null;
}

/** `GET /operaciones-almacen`. */
export interface OperacionesDelDia {
  fecha: string;
  hoy: string;
  operaciones: OperacionAlmacen[];
}

/**
 * El Registro de Operacion (parte 1): entradas, envios, merma de almacen,
 * consumo y descuentos. Un solo recurso; el servicio exige el permiso del tipo
 * (`operacion.<tipo>`, D15) en listar, ver, crear, corregir y dar de baja.
 *
 * Alcance como el corte: un usuario atado solo registra en su sucursal (pedir
 * otra al listar o crear = 403; una operacion de otra sucursal = 404). Un envio
 * se ve en Entradas del destino (D14) aunque no se alcance el origen.
 */
@Injectable()
export class OperacionesAlmacenService {
  constructor(
    private readonly repo: OperacionesAlmacenRepository,
    private readonly permisos: PermisosRepository,
  ) {}

  /** `GET /operaciones-almacen`. */
  async listar(
    usuarioId: string,
    q: ConsultaOperacionesDto,
  ): Promise<OperacionesDelDia> {
    await this.exigirPermiso(usuarioId, q.tipo);
    const hoy = await this.repo.hoyEnTijuana();
    if (!esFechaReal(q.fecha))
      throw new BadRequestException(MENSAJE_FECHA_INVALIDA);
    if (q.fecha > hoy) throw this.errorDeFecha([MENSAJE_FECHA_FUTURA], hoy);
    const sucursal = await this.sucursalEnAlcance(usuarioId, q.sucursal);

    const filas = await this.repo.listar(sucursal.id, q.fecha, q.tipo);
    const lineas = await this.repo.lineasDe(filas.map((f) => f.id));
    return {
      fecha: q.fecha,
      hoy,
      operaciones: filas.map((f) =>
        // Un envio en la lista de Entradas es el del destino: solo lectura.
        this.armar(f, lineas, hoy, f.tipo === 'envio' && q.tipo === 'entrada'),
      ),
    };
  }

  /** `GET /operaciones-almacen/:id`. */
  async leer(usuarioId: string, id: string): Promise<OperacionAlmacen> {
    const fila = await this.propia(usuarioId, id);
    const hoy = await this.repo.hoyEnTijuana();
    return this.armarConLineas(fila, hoy);
  }

  /** `POST /operaciones-almacen`. */
  async crear(
    usuarioId: string,
    dto: CrearOperacionDto,
  ): Promise<OperacionAlmacen> {
    await this.exigirPermiso(usuarioId, dto.tipo);
    const hoy = await this.repo.hoyEnTijuana();
    const sucursalCodigo = normalizarSucursalPedida(dto.sucursal);
    const errores = validarOperacion(
      {
        tipo: dto.tipo,
        fecha: dto.fecha,
        sucursal: sucursalCodigo ?? '',
        origen: dto.origen,
        destino: dto.destino,
        motivoId: dto.motivoId,
        trabajador: dto.trabajador,
        comentario: dto.comentario,
        lineas: this.lineasDe(dto),
      },
      hoy,
    );
    if (errores.length > 0) throw this.errorDeFecha(errores, hoy);
    const sucursal = await this.sucursalEnAlcance(usuarioId, dto.sucursal);
    const lineas = this.lineasDe(dto);

    const id = await this.repo.enTransaccion(async (trx) => {
      const datos = await this.datosDe(dto.tipo, dto, sucursal.id, null, trx);
      await this.exigirPresentaciones(lineas, new Set(), trx);
      const nuevo = await this.repo.insertar(
        sucursal.id,
        dto.tipo,
        datos,
        usuarioId,
        trx,
      );
      await this.repo.insertarLineas(nuevo, lineas, trx);
      return nuevo;
    });
    return this.armarConLineas((await this.repo.porId(id))!, hoy);
  }

  /** `PUT /operaciones-almacen/:id`: reemplaza los datos y las lineas. */
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarOperacionDto,
  ): Promise<OperacionAlmacen> {
    const previa = await this.propia(usuarioId, id);
    const hoy = await this.repo.hoyEnTijuana();
    const lineas = this.lineasDe(dto);
    const errores = validarOperacion(
      {
        tipo: previa.tipo,
        fecha: dto.fecha,
        sucursal: previa.sucursalCodigo,
        origen: dto.origen,
        destino: dto.destino,
        motivoId: dto.motivoId,
        trabajador: dto.trabajador,
        comentario: dto.comentario,
        lineas,
      },
      hoy,
    );
    if (errores.length > 0) throw this.errorDeFecha(errores, hoy);

    await this.repo.enTransaccion(async (trx) => {
      // El candado va primero y todo se relee bajo el: otra edicion o baja
      // simultanea no pisa esta.
      const fila = await this.repo.bloquear(id, trx);
      if (!fila) throw new NotFoundException(MOTIVO_OPERACION_INEXISTENTE);
      this.exigirFechaAbierta(fila, hoy);
      await this.exigirRetiroEditable(fila, hoy, trx);
      const datos = await this.datosDe(
        fila.tipo,
        dto,
        fila.sucursalId,
        fila.motivoId,
        trx,
      );
      const vivas = await this.repo.lineasVivas(id, trx);
      await this.exigirPresentaciones(
        lineas,
        new Set(vivas.map((v) => v.presentacionId)),
        trx,
      );
      const plan = planLineas(vivas, lineas);
      await this.repo.actualizar(id, datos, usuarioId, trx);
      // R3: un rechazado corregido vuelve a pendiente.
      if (fila.estado === 'rechazado') await this.repo.reabrirRetiro(id, trx);
      await this.repo.borrarLineas(plan.borrar, trx);
      await this.repo.actualizarLineas(plan.actualizar, trx);
      await this.repo.insertarLineas(id, plan.crear, trx);
    });
    return this.armarConLineas((await this.repo.porId(id))!, hoy);
  }

  /** `DELETE /operaciones-almacen/:id`: baja logica. */
  async eliminar(usuarioId: string, id: string): Promise<void> {
    await this.propia(usuarioId, id);
    const hoy = await this.repo.hoyEnTijuana();
    await this.repo.enTransaccion(async (trx) => {
      const fila = await this.repo.bloquear(id, trx);
      if (!fila) throw new NotFoundException(MOTIVO_OPERACION_INEXISTENTE);
      this.exigirFechaAbierta(fila, hoy);
      await this.exigirRetiroEditable(fila, hoy, trx);
      await this.repo.darDeBaja(id, usuarioId, trx);
    });
  }

  /** `GET /operaciones-almacen/retiros-pendientes`: la bandeja de Administracion. */
  async retirosPendientes(
    usuarioId: string,
    pedida: string | undefined,
  ): Promise<{ retiros: OperacionAlmacen[] }> {
    const usuario = await this.usuario(usuarioId);
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(pedida),
    );
    let sucursalId: string | null = null;
    if (alcance.tipo === 'una') {
      const sucursal = await this.repo.sucursalPorCodigo(alcance.codigo);
      if (!sucursal) throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
      sucursalId = sucursal.id;
    }
    const hoy = await this.repo.hoyEnTijuana();
    const filas = await this.repo.pendientesDeRetiro(sucursalId);
    const lineas = await this.repo.lineasDe(filas.map((f) => f.id));
    return { retiros: filas.map((f) => this.armar(f, lineas, hoy, false)) };
  }

  /** `POST /operaciones-almacen/:id/autorizar`. */
  autorizarRetiro(
    usuarioId: string,
    id: string,
    vista: string,
  ): Promise<OperacionAlmacen> {
    return this.resolverRetiro(usuarioId, id, 'autorizado', null, vista);
  }

  /** `POST /operaciones-almacen/:id/rechazar`. */
  rechazarRetiro(
    usuarioId: string,
    id: string,
    motivo: string,
    vista: string,
  ): Promise<OperacionAlmacen> {
    const errores = validarMotivoRechazo(motivo);
    if (errores.length > 0) throw new BadRequestException(errores);
    return this.resolverRetiro(
      usuarioId,
      id,
      'rechazado',
      motivo.trim(),
      vista,
    );
  }

  /**
   * Solo un retiro pendiente de la sucursal del usuario (otra, otro tipo o
   * inexistente = el mismo 404). Se decide sobre la fila bloqueada: si ya no
   * esta pendiente, 409 con la operacion como quedo.
   */
  private async resolverRetiro(
    usuarioId: string,
    id: string,
    estado: 'autorizado' | 'rechazado',
    motivo: string | null,
    vista: string,
  ): Promise<OperacionAlmacen> {
    const usuario = await this.usuario(usuarioId);
    const previa = await this.repo.porId(id);
    if (
      !previa ||
      previa.tipo !== 'retiro_merma' ||
      (usuario.codigo !== null && usuario.codigo !== previa.sucursalCodigo)
    )
      throw new NotFoundException(MOTIVO_OPERACION_INEXISTENTE);
    const hoy = await this.repo.hoyEnTijuana();

    await this.repo.enTransaccion(async (trx) => {
      const fila = await this.repo.bloquear(id, trx);
      if (!fila) throw new NotFoundException(MOTIVO_OPERACION_INEXISTENTE);
      if (!retiroResoluble(fila.estado))
        throw await this.conflicto(
          mensajeRetiroNoPendiente(fila.estado),
          fila,
          hoy,
          trx,
        );
      // Solo se resuelve lo que se vio: si Produccion lo corrigio mientras
      // Administracion lo revisaba, la marca ya no coincide.
      if (fila.actualizadoEn !== vista)
        throw await this.conflicto(MENSAJE_RETIRO_CAMBIO, fila, hoy, trx);
      await this.repo.resolverRetiro(id, estado, motivo, usuarioId, trx);
    });
    return this.armarConLineas((await this.repo.porId(id))!, hoy);
  }

  /** Un retiro autorizado es final: corregirlo o darlo de baja = 409. */
  private async exigirRetiroEditable(
    fila: FilaOperacion,
    hoy: string,
    trx: Transaction<DB>,
  ): Promise<void> {
    if (fila.tipo === 'retiro_merma' && !retiroEditable(fila.estado))
      throw await this.conflicto(MENSAJE_RETIRO_AUTORIZADO, fila, hoy, trx);
  }

  /** 409 con la operacion tal como esta ahora. */
  private async conflicto(
    mensaje: string,
    fila: FilaOperacion,
    hoy: string,
    trx: Transaction<DB>,
  ): Promise<ConflictException> {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: mensaje,
      operacion: this.armar(
        fila,
        await this.repo.lineasDe([fila.id], trx),
        hoy,
        false,
      ),
    });
  }

  // --- piezas internas -----------------------------------------------------

  /**
   * Una operacion viva de la sucursal del usuario (otra o inexistente = el mismo
   * 404) y con el permiso de su tipo (403). El alcance va antes que el permiso:
   * no se le dice a nadie de una operacion ajena.
   */
  private async propia(usuarioId: string, id: string): Promise<FilaOperacion> {
    const usuario = await this.usuario(usuarioId);
    const fila = await this.repo.porId(id);
    if (
      !fila ||
      (usuario.codigo !== null && usuario.codigo !== fila.sucursalCodigo)
    )
      throw new NotFoundException(MOTIVO_OPERACION_INEXISTENTE);
    await this.exigirPermiso(usuarioId, fila.tipo);
    return fila;
  }

  private async exigirPermiso(
    usuarioId: string,
    tipo: TipoOperacion,
  ): Promise<void> {
    const permisos = await this.permisos.permisosDe(usuarioId);
    if (!permisos.has(`operacion.${tipo}`))
      throw new ForbiddenException(MOTIVO_SIN_PERMISO);
  }

  /** La regla de fecha del tipo tambien rige al corregir y dar de baja (D13). */
  private exigirFechaAbierta(fila: FilaOperacion, hoy: string): void {
    if (!fechaPermitida(fila.tipo, fila.fecha, hoy))
      throw this.errorDeFecha([MOTIVO_ENVIO_CERRADO], hoy);
  }

  /**
   * Los datos que se guardan segun el tipo (lo que no es del tipo queda en
   * null). `motivoActual` es el de la operacion que se corrige: lo conserva
   * aunque ya este dado de baja o sin "almacen".
   */
  private async datosDe(
    tipo: TipoOperacion,
    dto: EditarOperacionDto,
    sucursalId: string,
    motivoActual: string | null,
    trx: Transaction<DB>,
  ): Promise<DatosOperacion> {
    let destinoId: string | null = null;
    if (tipo === 'envio') {
      const destino = await this.repo.sucursalPorCodigo(
        normalizarSucursalPedida(dto.destino) ?? '',
        trx,
      );
      if (!destino) throw new BadRequestException(MOTIVO_DESTINO_INEXISTENTE);
      if (destino.id === sucursalId)
        throw new BadRequestException(
          'El destino tiene que ser otra sucursal.',
        );
      destinoId = destino.id;
    }

    let motivoId: string | null = null;
    if (tipo === 'merma') {
      motivoId = dto.motivoId!.toLowerCase();
      if (motivoId !== motivoActual) {
        const motivo = await this.repo.motivo(motivoId, trx);
        if (!motivo || !motivo.activo || !motivo.aplicaAlmacen)
          throw new BadRequestException(MOTIVO_MOTIVO_MERMA);
      }
    }

    return {
      fecha: dto.fecha,
      origen: tipo === 'entrada' ? (dto.origen ?? null) : null,
      destinoId,
      motivoId,
      trabajador: tipo === 'descuento' ? (dto.trabajador ?? '').trim() : null,
      comentario: dto.comentario?.trim() ? dto.comentario.trim() : null,
    };
  }

  /**
   * Toda presentacion que no estaba ya en la operacion tiene que existir (viva;
   * activa o no). Una que ya estaba pasa aunque se haya dado de baja: la
   * pantalla reenvia lo que leyo.
   */
  private async exigirPresentaciones(
    lineas: readonly LineaPedida[],
    yaEstaban: ReadonlySet<string>,
    trx: Transaction<DB>,
  ): Promise<void> {
    const porRevisar = lineas
      .map((l) => l.presentacionId)
      .filter((id) => !yaEstaban.has(id));
    const existen = await this.repo.idsPresentacionesVivas(porRevisar, trx);
    if (porRevisar.some((id) => !existen.has(id)))
      throw new BadRequestException(MOTIVO_PRESENTACION_INEXISTENTE);
  }

  private lineasDe(dto: EditarOperacionDto): LineaPedida[] {
    return dto.lineas.map((l) => ({
      presentacionId: l.presentacionId.toLowerCase(),
      piezas: l.piezas,
    }));
  }

  private async armarConLineas(
    fila: FilaOperacion,
    hoy: string,
  ): Promise<OperacionAlmacen> {
    return this.armar(fila, await this.repo.lineasDe([fila.id]), hoy, false);
  }

  private armar(
    f: FilaOperacion,
    todas: LineaOperacion[],
    hoy: string,
    comoEntradaDelDestino: boolean,
  ): OperacionAlmacen {
    const lineas = todas
      .filter((l) => l.operacionId === f.id)
      .map((l) => ({
        presentacionId: l.presentacionId,
        nombre: l.nombre,
        producto: l.producto,
        volumen: l.volumen,
        piezas: l.piezas,
      }));
    const comun = {
      id: f.id,
      fecha: f.fecha,
      motivo:
        f.motivoId !== null
          ? { id: f.motivoId, nombre: f.motivoNombre ?? '' }
          : null,
      trabajador: f.trabajador,
      comentario: f.comentario,
      lineas,
      piezas: lineas.reduce((suma, l) => suma + l.piezas, 0),
      capturo: f.capturo,
      hora: f.hora,
      estado: f.estado,
      actualizadoEn: f.actualizadoEn,
      resolucion:
        f.estado !== null && f.estado !== 'pendiente'
          ? {
              por: f.resueltoPor ?? '',
              en: f.resueltoEn ?? '',
              motivo: f.motivoRechazo,
            }
          : null,
    };
    if (comoEntradaDelDestino) {
      // El envio visto desde el destino: una entrada de esa sucursal, de solo
      // lectura (se corrige desde el origen, con `operacion.envio`).
      return {
        ...comun,
        tipo: 'entrada',
        sucursal: { id: f.destinoId!, codigo: f.destinoCodigo! },
        origen: null,
        destino: null,
        editable: false,
        envio: { origen: { id: f.sucursalId, codigo: f.sucursalCodigo } },
      };
    }
    return {
      ...comun,
      tipo: f.tipo,
      sucursal: { id: f.sucursalId, codigo: f.sucursalCodigo },
      origen: f.origen as OperacionAlmacen['origen'],
      destino:
        f.destinoId !== null
          ? { id: f.destinoId, codigo: f.destinoCodigo! }
          : null,
      editable:
        fechaPermitida(f.tipo, f.fecha, hoy) && retiroEditable(f.estado),
      envio: null,
    };
  }

  /** 400 con los mensajes y el "hoy" de Tijuana (como el corte). */
  private errorDeFecha(mensajes: string[], hoy: string): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: mensajes,
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
