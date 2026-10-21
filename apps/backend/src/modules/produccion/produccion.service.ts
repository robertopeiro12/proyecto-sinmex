import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import {
  normalizarSucursalPedida,
  TODAS,
} from '../sucursales/alcance-sucursal';
import type {
  ConsultaProduccionDto,
  GuardarProduccionDto,
} from './dto/produccion.dto';
import {
  ProduccionRepository,
  type DiaSucursal,
  type LineaDelDia,
  type SucursalProduccion,
} from './produccion.repository';
import {
  MENSAJE_FECHA_INVALIDA,
  planDelDia,
  validarDia,
} from './reglas-produccion';

export const MOTIVO_ELIGE_SUCURSAL = 'Elige la sucursal.';
export const MOTIVO_SUCURSAL_INEXISTENTE = 'No existe esa sucursal.';
export const MOTIVO_PRESENTACION_INEXISTENTE =
  'Una de las presentaciones no existe.';
export const MOTIVO_GUARDADO_SIMULTANEO =
  'Otra captura guardó este día al mismo tiempo; vuelve a guardar.';

/** La respuesta del `GET` y del `PUT /produccion` (camelCase). */
export interface DiaProduccion {
  fecha: string;
  sucursal: { id: string; codigo: string };
  lineas: LineaDelDia[];
  totalPiezas: number;
  actualizadoEn: string | null;
}

/** `AAAA-MM-DD` que existe en el calendario (el DTO ya comprobo el formato). */
function esFechaReal(fecha: string): boolean {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    f.getUTCFullYear() === anio &&
    f.getUTCMonth() === mes - 1 &&
    f.getUTCDate() === dia
  );
}

/**
 * La produccion por dia (T-25): piezas por presentacion de un dia y una
 * sucursal, con el total. Se guarda el dia completo de una vez.
 *
 * El alcance es el de las cargas: un usuario atado solo ve y captura su
 * sucursal, y pedir otra es **404** (no se le confirma que exista).
 */
@Injectable()
export class ProduccionService {
  constructor(private readonly repo: ProduccionRepository) {}

  /** `GET /produccion`. */
  async leer(
    usuarioId: string,
    q: ConsultaProduccionDto,
  ): Promise<DiaProduccion> {
    if (!esFechaReal(q.fecha))
      throw new BadRequestException(MENSAJE_FECHA_INVALIDA);
    const sucursal = await this.sucursalEnAlcance(usuarioId, q.sucursal);
    return this.armarDia(sucursal, q.fecha);
  }

  /**
   * `PUT /produccion`: reemplaza el dia. Las reglas validan antes de abrir la
   * transaccion (fecha futura contra hoy en Tijuana, piezas, repetidas); dentro,
   * con las filas vivas bloqueadas, se aplica `planDelDia`: crea, corrige o da
   * de baja (0 o ausente = sin registro).
   */
  async guardar(
    usuarioId: string,
    dto: GuardarProduccionDto,
  ): Promise<DiaProduccion> {
    const lineas = dto.lineas.map((l) => ({
      presentacionId: l.presentacionId.toLowerCase(),
      piezas: l.piezas,
    }));
    const errores = validarDia(
      { fecha: dto.fecha, lineas },
      await this.repo.hoyEnTijuana(),
    );
    if (errores.length > 0) throw new BadRequestException(errores);
    const sucursal = await this.sucursalEnAlcance(usuarioId, dto.sucursal);
    const dia: DiaSucursal = { sucursalId: sucursal.id, fecha: dto.fecha };

    try {
      return await this.repo.enTransaccion(async (trx) => {
        const vivas = await this.repo.bloquearVivas(dia, trx);
        await this.exigirPresentaciones(lineas, vivas, trx);
        const plan = planDelDia(vivas, lineas);
        await this.repo.darDeBaja(plan.borrar, usuarioId, trx);
        await this.repo.actualizar(plan.actualizar, usuarioId, trx);
        await this.repo.insertar(dia, plan.crear, usuarioId, trx);
        return this.armarDia(sucursal, dto.fecha, trx);
      });
    } catch (error) {
      // Dos primeros guardados simultaneos del mismo dia: no habia filas que
      // bloquear y el indice unico parcial frena al segundo.
      if (esViolacionUnicidad(error))
        throw new ConflictException(MOTIVO_GUARDADO_SIMULTANEO);
      throw error;
    }
  }

  /**
   * Toda presentacion con piezas tiene que existir (viva, activa o no). Una que
   * ya tiene fila viva ese dia pasa aunque se haya dado de baja del catalogo:
   * el portal reenvia el dia tal como lo leyo.
   */
  private async exigirPresentaciones(
    lineas: readonly { presentacionId: string; piezas: number }[],
    vivas: readonly { presentacionId: string }[],
    trx: Transaction<DB>,
  ): Promise<void> {
    const conFila = new Set(vivas.map((v) => v.presentacionId));
    const porRevisar = lineas
      .filter((l) => l.piezas > 0 && !conFila.has(l.presentacionId))
      .map((l) => l.presentacionId);
    const existen = await this.repo.idsPresentacionesVivas(porRevisar, trx);
    if (porRevisar.some((id) => !existen.has(id))) {
      throw new BadRequestException(MOTIVO_PRESENTACION_INEXISTENTE);
    }
  }

  private async armarDia(
    sucursal: SucursalProduccion,
    fecha: string,
    db?: Kysely<DB>,
  ): Promise<DiaProduccion> {
    const dia: DiaSucursal = { sucursalId: sucursal.id, fecha };
    const [lineas, actualizadoEn] = await Promise.all([
      this.repo.lineasDelDia(dia, db),
      this.repo.actualizadoEn(dia, db),
    ]);
    return {
      fecha,
      sucursal: { id: sucursal.id, codigo: sucursal.codigo },
      lineas,
      totalPiezas: lineas.reduce((suma, l) => suma + l.piezas, 0),
      actualizadoEn:
        actualizadoEn === null ? null : actualizadoEn.toISOString(),
    };
  }

  /**
   * La sucursal pedida por codigo, si el usuario la alcanza. General: tiene que
   * elegir una (400). Atado: la suya sin pedirla; otra = 404.
   */
  private async sucursalEnAlcance(
    usuarioId: string,
    pedida: string | undefined,
  ): Promise<SucursalProduccion> {
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    const normalizada = normalizarSucursalPedida(pedida);
    const codigo =
      normalizada === null || normalizada === TODAS
        ? usuario.codigo
        : normalizada;
    if (codigo === null) throw new BadRequestException(MOTIVO_ELIGE_SUCURSAL);
    if (usuario.codigo !== null && usuario.codigo !== codigo) {
      throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
    }
    const sucursal = await this.repo.sucursalPorCodigo(codigo);
    if (!sucursal) throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
    return sucursal;
  }
}
