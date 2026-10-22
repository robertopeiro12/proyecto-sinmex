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
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import type { ConsultaRetornoDto, GuardarRetornoDto } from './dto/retorno.dto';
import {
  esFechaReal,
  MENSAJE_FECHA_INVALIDA,
  MOTIVO_GUARDADO_SIMULTANEO,
  MOTIVO_PRESENTACION_INEXISTENTE,
  planDelDia,
  validarDia,
  type LineaPedida,
} from './reglas-produccion';
import {
  RetornosRepository,
  type DiaVendedor,
  type LineaRetorno,
  type VendedorRetorno,
} from './retornos.repository';

export const MOTIVO_VENDEDOR_INEXISTENTE = 'No existe ese vendedor.';

/** La respuesta del `GET` y del `PUT /retornos` (camelCase). */
export interface DiaRetorno {
  fecha: string;
  vendedor: { id: string; nombre: string };
  sucursal: { id: string; codigo: string };
  lineas: LineaRetorno[];
  totalPiezas: number;
  actualizadoEn: string | null;
}

/**
 * El retorno del vendedor: piezas buenas que el almacenista recibe de vuelta,
 * por presentacion, de un vendedor y un dia. Se guarda el dia completo (0 = sin
 * registro). No se compara contra lo cargado: el cuadre es del corte (T-27).
 *
 * El alcance va por el vendedor: un usuario atado solo alcanza a los de su
 * sucursal, y otro es **404** (no se le confirma que exista). La `sucursal_id`
 * del retorno es siempre la del vendedor, nunca del cuerpo.
 */
@Injectable()
export class RetornosService {
  constructor(private readonly repo: RetornosRepository) {}

  /** `GET /retornos`. */
  async leer(usuarioId: string, q: ConsultaRetornoDto): Promise<DiaRetorno> {
    if (!esFechaReal(q.fecha))
      throw new BadRequestException(MENSAJE_FECHA_INVALIDA);
    const vendedor = await this.vendedorEnAlcance(usuarioId, q.vendedor);
    return this.armarDia(vendedor, q.fecha);
  }

  /**
   * `PUT /retornos`: reemplaza el dia. Las reglas de la produccion validan antes
   * de abrir la transaccion; dentro, con la fila del vendedor y las filas vivas
   * bloqueadas, se aplica `planDelDia`. El vendedor se relee bajo su candado y
   * de ahi sale la sucursal que se guarda.
   */
  async guardar(
    usuarioId: string,
    dto: GuardarRetornoDto,
  ): Promise<DiaRetorno> {
    const lineas = dto.lineas.map((l) => ({
      presentacionId: l.presentacionId.toLowerCase(),
      piezas: l.piezas,
    }));
    const errores = validarDia(
      { fecha: dto.fecha, lineas },
      await this.repo.hoyEnTijuana(),
    );
    if (errores.length > 0) throw new BadRequestException(errores);
    const alcance = await this.alcanceDe(usuarioId);
    const vendedorId = dto.vendedor.toLowerCase();
    // Antes de la transaccion: un vendedor fuera de alcance no bloquea nada.
    this.exigirAlcance(alcance, await this.repo.vendedor(vendedorId));
    const dia: DiaVendedor = { vendedorId, fecha: dto.fecha };

    try {
      return await this.repo.enTransaccion(async (trx) => {
        await this.repo.bloquearVendedor(vendedorId, trx);
        const vendedor = this.exigirAlcance(
          alcance,
          await this.repo.vendedor(vendedorId, trx),
        );
        const vivas = await this.repo.bloquearVivas(dia, trx);
        await this.exigirPresentaciones(dia, lineas, vivas, trx);
        const plan = planDelDia(vivas, lineas);
        await this.repo.darDeBaja(plan.borrar, usuarioId, trx);
        await this.repo.actualizar(plan.actualizar, usuarioId, trx);
        await this.repo.insertar(
          dia,
          vendedor.sucursalId,
          plan.crear,
          usuarioId,
          trx,
        );
        return this.armarDia(vendedor, dto.fecha, trx);
      });
    } catch (error) {
      // Red de seguridad: con el vendedor bloqueado dos guardados ya no chocan;
      // solo una escritura que no pase por aqui puede disparar el indice unico.
      if (esViolacionUnicidad(error))
        throw new ConflictException(MOTIVO_GUARDADO_SIMULTANEO);
      throw error;
    }
  }

  /**
   * Toda presentacion con piezas tiene que poder capturarse: viva, o con fila
   * viva ese dia (el portal reenvia el dia como lo leyo), o cargada ese dia.
   */
  private async exigirPresentaciones(
    dia: DiaVendedor,
    lineas: readonly LineaPedida[],
    vivas: readonly { presentacionId: string }[],
    trx: Transaction<DB>,
  ): Promise<void> {
    const conFila = new Set(vivas.map((v) => v.presentacionId));
    const porRevisar = lineas
      .filter((l) => l.piezas > 0 && !conFila.has(l.presentacionId))
      .map((l) => l.presentacionId);
    const capturables = await this.repo.idsCapturables(dia, porRevisar, trx);
    if (porRevisar.some((id) => !capturables.has(id))) {
      throw new BadRequestException(MOTIVO_PRESENTACION_INEXISTENTE);
    }
  }

  private async armarDia(
    vendedor: VendedorRetorno,
    fecha: string,
    db?: Kysely<DB>,
  ): Promise<DiaRetorno> {
    const dia: DiaVendedor = { vendedorId: vendedor.id, fecha };
    const [lineas, actualizadoEn] = await Promise.all([
      this.repo.lineasDelDia(dia, db),
      this.repo.actualizadoEn(dia, db),
    ]);
    return {
      fecha,
      vendedor: { id: vendedor.id, nombre: vendedor.nombre },
      sucursal: { id: vendedor.sucursalId, codigo: vendedor.sucursalCodigo },
      lineas,
      totalPiezas: lineas.reduce((suma, l) => suma + l.piezas, 0),
      actualizadoEn:
        actualizadoEn === null ? null : actualizadoEn.toISOString(),
    };
  }

  /** El alcance del usuario; 401 si ya no existe. */
  private async alcanceDe(usuarioId: string) {
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    return resolverAlcance(usuario.codigo, null);
  }

  /** Inexistente, dado de baja o de otra sucursal: el mismo 404. */
  private exigirAlcance(
    alcance: Awaited<ReturnType<RetornosService['alcanceDe']>>,
    vendedor: VendedorRetorno | undefined,
  ): VendedorRetorno {
    if (
      !vendedor ||
      (alcance.tipo === 'una' && alcance.codigo !== vendedor.sucursalCodigo)
    ) {
      throw new NotFoundException(MOTIVO_VENDEDOR_INEXISTENTE);
    }
    return vendedor;
  }

  private async vendedorEnAlcance(
    usuarioId: string,
    vendedorId: string,
  ): Promise<VendedorRetorno> {
    const alcance = await this.alcanceDe(usuarioId);
    return this.exigirAlcance(
      alcance,
      await this.repo.vendedor(vendedorId.toLowerCase()),
    );
  }
}
