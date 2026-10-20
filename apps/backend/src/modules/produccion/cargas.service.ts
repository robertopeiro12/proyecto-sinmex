import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import type { CargaPull } from '../sincronizacion/contrato';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import type {
  ConsultaCargasDto,
  CrearCargaDto,
  EditarCargaDto,
  RespuestaCargaDto,
  VersionCargaDto,
} from './dto/cargas.dto';
import { CargasRepository, type VendedorParaCarga } from './cargas.repository';
import {
  aCargaPull,
  aCargaRejilla,
  armarRejilla,
  decidirRespuesta,
  MOTIVO_RESPUESTA_CONFLICTO,
  motivoNoEditable,
  normalizarLineas,
  normalizarRespuesta,
  validarLineas,
  type CargaRejilla,
  type FilaCarga,
  type LineaCarga,
  type Rejilla,
  type SucursalRejilla,
} from './reglas-carga';

export const MOTIVO_FECHA_INEXISTENTE = 'Esa fecha no existe.';
export const MOTIVO_ELIGE_SUCURSAL = 'Elige la sucursal.';
export const MOTIVO_SUCURSAL_INEXISTENTE = 'No existe esa sucursal.';
export const MOTIVO_VENDEDOR_INEXISTENTE = 'No existe ese vendedor.';
export const MOTIVO_VENDEDOR_INACTIVO =
  'Ese vendedor está desactivado: no se le captura carga.';
export const MOTIVO_CARGA_INEXISTENTE = 'No existe esa carga.';
export const MOTIVO_NUMERO_OCUPADO =
  'Otra captura tomó el mismo número de carga al mismo tiempo; vuelve a guardar.';

/** `AAAA-MM-DD` que existe en el calendario (el DTO ya comprobo el formato). */
function exigirFechaReal(fecha: string): void {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    f.getUTCFullYear() !== anio ||
    f.getUTCMonth() !== mes - 1 ||
    f.getUTCDate() !== dia
  ) {
    throw new BadRequestException(MOTIVO_FECHA_INEXISTENTE);
  }
}

/**
 * La carga del vendedor en el servidor (T-27 pieza 1): la rejilla de Produccion
 * › Recarga (D1) y, en la Tarea 3, la respuesta del vendedor y el pull.
 *
 * El alcance es el de siempre (`resolverAlcance`), pero otra sucursal es **404**
 * y no 403: a un usuario atado no se le confirma que exista el vendedor, la
 * sucursal o la carga de otra (mismo criterio que la ruta diaria, T-37).
 */
@Injectable()
export class CargasService {
  constructor(private readonly repo: CargasRepository) {}

  /** `GET /cargas`. */
  async rejilla(usuarioId: string, q: ConsultaCargasDto): Promise<Rejilla> {
    exigirFechaReal(q.fecha);
    const sucursal = await this.sucursalEnAlcance(usuarioId, q.sucursal);
    const [vendedores, cargas] = await Promise.all([
      this.repo.vendedoresDeRejilla(sucursal.id, q.fecha),
      this.repo.leerCargas({ sucursalId: sucursal.id, fecha: q.fecha }),
    ]);
    const referenciadas = [
      ...new Set(cargas.flatMap((c) => c.lineas.map((l) => l.presentacionId))),
    ];
    const presentaciones =
      await this.repo.presentacionesDeRejilla(referenciadas);
    return armarRejilla({
      fecha: q.fecha,
      sucursal,
      presentaciones,
      vendedores,
      cargas,
    });
  }

  /**
   * `POST /cargas`: la carga de HOY en Tijuana (D8), pendiente, version 1, con
   * el numero siguiente. El numero se calcula con la fila del vendedor
   * bloqueada; si aun asi choca con el indice unico, 409 y se vuelve a guardar.
   */
  async crear(usuarioId: string, dto: CrearCargaDto): Promise<CargaRejilla> {
    const vendedor = await this.vendedorEnAlcance(usuarioId, dto.vendedorId);
    if (!vendedor.activo)
      throw new BadRequestException(MOTIVO_VENDEDOR_INACTIVO);
    const lineas = normalizarLineas(dto.lineas);
    await this.exigirLineasValidas(lineas);
    const hoy = await this.repo.hoyEnTijuana();

    let id: string;
    try {
      id = await this.repo.enTransaccion(async (trx) => {
        await this.repo.bloquearVendedor(vendedor.id, trx);
        const numero = await this.repo.siguienteNumero(vendedor.id, hoy, trx);
        const nueva = await this.repo.insertarCarga(
          {
            sucursalId: vendedor.sucursalId,
            vendedorId: vendedor.id,
            fecha: hoy,
            numero,
            capturoUsuarioId: usuarioId,
          },
          trx,
        );
        await this.repo.insertarLineas(nueva, lineas, trx);
        return nueva;
      });
    } catch (error) {
      if (esViolacionUnicidad(error))
        throw new ConflictException(MOTIVO_NUMERO_OCUPADO);
      throw error;
    }
    return this.cargaRejilla(id);
  }

  /**
   * `PATCH /cargas/:id`: solo pendiente o rechazada, de hoy y con la version que
   * se edito; reemplaza las lineas y la regresa a pendiente (D5), asi que
   * vuelve a llegar al vendedor.
   */
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarCargaDto,
  ): Promise<CargaRejilla> {
    const lineas = normalizarLineas(dto.lineas);
    await this.exigirLineasValidas(lineas);
    const hoy = await this.repo.hoyEnTijuana();
    await this.repo.enTransaccion(async (trx) => {
      const carga = await this.cargaEnAlcance(usuarioId, id, trx);
      this.exigirEditable(carga, hoy, dto.version);
      await this.repo.reemplazarLineas(carga.id, lineas, trx);
      await this.repo.marcarEditada(carga.id, trx);
    });
    return this.cargaRejilla(id);
  }

  /** `DELETE /cargas/:id`: baja logica con las mismas condiciones que editar. */
  async eliminar(
    usuarioId: string,
    id: string,
    dto: VersionCargaDto,
  ): Promise<{ id: string }> {
    const hoy = await this.repo.hoyEnTijuana();
    await this.repo.enTransaccion(async (trx) => {
      const carga = await this.cargaEnAlcance(usuarioId, id, trx);
      this.exigirEditable(carga, hoy, dto.version);
      await this.repo.darDeBaja(carga.id, trx);
    });
    return { id };
  }

  /** La coleccion `cargas` del pull para el vendedor del token (T-27). */
  async paraPull(vendedorId: string, desde: Date | null): Promise<CargaPull[]> {
    return (await this.repo.leerCargas({ vendedorId, desde })).map(aCargaPull);
  }

  /**
   * `POST /sync/cargas/:id/respuesta` (D2, D6): aceptar o rechazar la carga
   * completa, con red y en el momento.
   *
   * La forma se valida primero (400). Despues, en una transaccion con la carga
   * bloqueada: de otro vendedor, inexistente o eliminada → 404 (no confirma que
   * exista); la misma respuesta otra vez → 200 sin reescribir (idempotente);
   * otra version o ya respondida → 409 con la carga actual; si no, se escribe.
   */
  async responder(
    vendedorId: string,
    cargaId: string,
    dto: RespuestaCargaDto,
  ): Promise<CargaPull> {
    const forma = normalizarRespuesta(dto.accion, dto.motivo);
    if (!forma.ok) throw new BadRequestException(forma.mensaje);
    if (!(await this.repo.vendedorActivo(vendedorId))) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    return this.repo.enTransaccion(async (trx) => {
      const carga = await this.repo.bloquearCarga(cargaId, trx);
      if (!carga || carga.vendedorId !== vendedorId) {
        throw new NotFoundException(MOTIVO_CARGA_INEXISTENTE);
      }
      const decision = decidirRespuesta(carga, forma.respuesta, dto.version);
      if (decision === 'conflicto') {
        throw new ConflictException({
          message: MOTIVO_RESPUESTA_CONFLICTO,
          carga: aCargaPull(carga),
        });
      }
      if (decision === 'escribir') {
        await this.repo.escribirRespuesta(carga.id, forma.respuesta, trx);
      }
      const [actual] = await this.repo.leerCargas({ id: carga.id }, trx);
      return aCargaPull(actual);
    });
  }

  private exigirEditable(carga: FilaCarga, hoy: string, version: number): void {
    const motivo = motivoNoEditable(carga, hoy, version);
    if (motivo !== null) {
      // Con la carga actual: el portal puede decir que cambio sin otra peticion.
      throw new ConflictException({
        message: motivo,
        carga: aCargaRejilla(carga),
      });
    }
  }

  private async exigirLineasValidas(
    lineas: readonly LineaCarga[],
  ): Promise<void> {
    const activas = await this.repo.idsPresentacionesActivas(
      lineas.map((l) => l.presentacionId),
    );
    const error = validarLineas(lineas, activas);
    if (error !== null) throw new BadRequestException(error);
  }

  private async cargaRejilla(id: string): Promise<CargaRejilla> {
    const [carga] = await this.repo.leerCargas({ id });
    return aCargaRejilla(carga);
  }

  /** El codigo de la sucursal del usuario o `null` si es General; 401 si ya no existe. */
  private async alcanceDe(usuarioId: string) {
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    return { usuario, alcance: resolverAlcance(usuario.codigo, null) };
  }

  private async sucursalEnAlcance(
    usuarioId: string,
    pedida: string | undefined,
  ): Promise<SucursalRejilla> {
    const { usuario, alcance } = await this.alcanceDe(usuarioId);
    const id =
      pedida?.toLowerCase() ?? (alcance.tipo === 'una' ? usuario.id : null);
    if (id === null) throw new BadRequestException(MOTIVO_ELIGE_SUCURSAL);
    const sucursal = await this.repo.sucursalPorId(id);
    if (
      !sucursal ||
      (alcance.tipo === 'una' && alcance.codigo !== sucursal.codigo)
    ) {
      throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
    }
    return sucursal;
  }

  private async vendedorEnAlcance(
    usuarioId: string,
    vendedorId: string,
  ): Promise<VendedorParaCarga> {
    const { alcance } = await this.alcanceDe(usuarioId);
    const vendedor = await this.repo.vendedorParaCarga(
      vendedorId.toLowerCase(),
    );
    if (
      !vendedor ||
      (alcance.tipo === 'una' && alcance.codigo !== vendedor.sucursalCodigo)
    ) {
      throw new NotFoundException(MOTIVO_VENDEDOR_INEXISTENTE);
    }
    return vendedor;
  }

  /** La carga viva bloqueada, si el usuario la alcanza; si no, 404. */
  private async cargaEnAlcance(
    usuarioId: string,
    id: string,
    trx: Transaction<DB>,
  ): Promise<FilaCarga> {
    const { alcance } = await this.alcanceDe(usuarioId);
    const carga = await this.repo.bloquearCarga(id.toLowerCase(), trx);
    if (
      !carga ||
      (alcance.tipo === 'una' && alcance.codigo !== carga.sucursalCodigo)
    ) {
      throw new NotFoundException(MOTIVO_CARGA_INEXISTENTE);
    }
    return carga;
  }
}
