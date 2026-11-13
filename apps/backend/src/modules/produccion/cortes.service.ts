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
  resolverAlcance,
  type Alcance,
} from '../sucursales/alcance-sucursal';
import type {
  ConsultaCorteVendedorDto,
  ConsultaCortesDto,
  GuardarCorteDto,
} from './dto/corte.dto';
import {
  CortesRepository,
  type DiaVendedor,
  type MovimientoVendedor,
  type VendedorCorte,
} from './cortes.repository';
import {
  armarCorte,
  planCorte,
  validarCorte,
  type ConteoPedido,
  type EstadoCorte,
  type LineaCorte,
  type TotalesCorte,
} from './reglas-corte';
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MOTIVO_GUARDADO_SIMULTANEO,
  MOTIVO_PRESENTACION_INEXISTENTE,
} from './reglas-produccion';

export const MOTIVO_VENDEDOR_INEXISTENTE = 'No existe ese vendedor.';

/** Un vendedor de la lista del dia (`GET /cortes`). */
export interface FilaCorte {
  vendedor: { id: string; nombre: string };
  sucursal: { id: string; codigo: string };
  piezasCargadas: number;
  estado: EstadoCorte;
  /** No tiene ninguna carga aceptada ese dia (D13). */
  sinCarga: boolean;
  /** Suma de faltantes > 0; `null` si el corte no esta hecho. */
  piezasFaltantes: number | null;
  hechoEn: string | null;
}

/** `GET /cortes`. */
export interface CortesDelDia {
  fecha: string;
  hoy: string;
  vendedores: FilaCorte[];
}

/** `GET` y `PUT /cortes/vendedor`. */
export interface CorteVendedor {
  fecha: string;
  hoy: string;
  vendedor: { id: string; nombre: string };
  sucursal: { id: string; codigo: string };
  lineas: LineaCortePantalla[];
  totales: TotalesCorte;
  hecho: { en: string; por: string } | null;
}

/** Una presentacion del corte, como la recibe el portal. */
export type LineaCortePantalla = Pick<
  LineaCorte,
  | 'presentacionId'
  | 'nombre'
  | 'cargadas'
  | 'vendidas'
  | 'regaladas'
  | 'deberiaRegresar'
  | 'buenas'
  | 'merma'
  | 'faltante'
>;

/**
 * El corte de mercancia (absorbe a Retorno): el almacenista cuenta lo que
 * regresa cada vendedor (buenas y merma, en `retorno`) y aqui se compara contra
 * lo que deberia regresar. La cuenta vive solo en `reglas-corte.ts`.
 *
 * Alcance como Retorno: un usuario atado solo alcanza a los vendedores de su
 * sucursal (otro = **404**, no se confirma que exista); la lista pide sucursal
 * por codigo o `todas` (`resolverAlcance`; otra ajena = 403).
 */
@Injectable()
export class CortesService {
  constructor(private readonly repo: CortesRepository) {}

  /** `GET /cortes`: los vendedores con carga aceptada, venta o conteo ese dia (D11). */
  async lista(usuarioId: string, q: ConsultaCortesDto): Promise<CortesDelDia> {
    const hoy = await this.exigirFecha(q.fecha);
    const usuario = await this.usuario(usuarioId);
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );
    const codigo = alcance.tipo === 'una' ? alcance.codigo : null;

    const movimientos = await this.repo.movimientos(q.fecha, {
      sucursalCodigo: codigo,
    });
    const porVendedor = new Map<string, MovimientoVendedor[]>();
    for (const m of movimientos) {
      const lista = porVendedor.get(m.vendedorId) ?? [];
      lista.push(m);
      porVendedor.set(m.vendedorId, lista);
    }
    const vendedores = await this.repo.vendedoresDelDia(q.fecha, codigo, [
      ...porVendedor.keys(),
    ]);

    return {
      fecha: q.fecha,
      hoy,
      vendedores: vendedores.map((v) => {
        const hecho = v.hechoEn !== null;
        const corte = armarCorte(porVendedor.get(v.id) ?? [], hecho);
        return {
          vendedor: { id: v.id, nombre: v.nombre },
          sucursal: { id: v.sucursalId, codigo: v.sucursalCodigo },
          piezasCargadas: corte.totales.cargadas,
          estado: corte.estado,
          sinCarga: !corte.lineas.some((l) => l.cargadas > 0),
          piezasFaltantes: corte.totales.faltante,
          hechoEn: v.hechoEn,
        };
      }),
    };
  }

  /** `GET /cortes/vendedor`. */
  async leer(
    usuarioId: string,
    q: ConsultaCorteVendedorDto,
  ): Promise<CorteVendedor> {
    const hoy = await this.exigirFecha(q.fecha);
    const alcance = await this.alcanceDe(usuarioId);
    const vendedor = this.exigirAlcance(
      alcance,
      await this.repo.vendedor(q.vendedor.toLowerCase()),
    );
    return this.armar(vendedor, q.fecha, hoy);
  }

  /**
   * `PUT /cortes/vendedor`: reemplaza el conteo del dia (0/0 da de baja) y deja
   * el corte hecho aunque no venga ninguna pieza (vendio todo, D13). Todo en una
   * transaccion con la fila del vendedor bloqueada; el vendedor se relee bajo su
   * candado y de ahi sale la sucursal que se guarda.
   */
  async guardar(
    usuarioId: string,
    dto: GuardarCorteDto,
  ): Promise<CorteVendedor> {
    const lineas: ConteoPedido[] = dto.lineas.map((l) => ({
      presentacionId: l.presentacionId.toLowerCase(),
      buenas: l.buenas,
      merma: l.merma,
    }));
    const hoy = await this.repo.hoyEnTijuana();
    const errores = validarCorte({ fecha: dto.fecha, lineas }, hoy);
    if (errores.length > 0) throw this.errorDeFecha(errores, hoy);
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
        await this.exigirPresentaciones(dia, lineas, trx);
        const plan = planCorte(vivas, lineas);
        await this.repo.darDeBaja(plan.borrar, usuarioId, trx);
        await this.repo.actualizar(plan.actualizar, usuarioId, trx);
        await this.repo.insertar(
          dia,
          vendedor.sucursalId,
          plan.crear,
          usuarioId,
          trx,
        );
        await this.repo.marcarHecho(dia, vendedor.sucursalId, usuarioId, trx);
        return this.armar(vendedor, dto.fecha, hoy, trx);
      });
    } catch (error) {
      // Red de seguridad: con el vendedor bloqueado dos guardados ya no chocan;
      // solo una escritura que no pase por aqui puede disparar un indice unico.
      if (esViolacionUnicidad(error))
        throw new ConflictException(MOTIVO_GUARDADO_SIMULTANEO);
      throw error;
    }
  }

  /**
   * Toda presentacion con piezas tiene que poder contarse: con movimiento ese
   * dia (carga, venta o conteo; aunque este desactivada o dada de baja) o viva
   * (para contar algo que no se esperaba, D13).
   */
  private async exigirPresentaciones(
    dia: DiaVendedor,
    lineas: readonly ConteoPedido[],
    trx: Transaction<DB>,
  ): Promise<void> {
    const conMovimiento = new Set(
      (await this.repo.movimientos(dia.fecha, dia, trx)).map(
        (m) => m.presentacionId,
      ),
    );
    const porRevisar = lineas
      .filter((l) => l.buenas + l.merma > 0)
      .map((l) => l.presentacionId)
      .filter((id) => !conMovimiento.has(id));
    const vivas = await this.repo.idsVivos(porRevisar, trx);
    if (porRevisar.some((id) => !vivas.has(id))) {
      throw new BadRequestException(MOTIVO_PRESENTACION_INEXISTENTE);
    }
  }

  private async armar(
    vendedor: VendedorCorte,
    fecha: string,
    hoy: string,
    db?: Kysely<DB>,
  ): Promise<CorteVendedor> {
    const dia: DiaVendedor = { vendedorId: vendedor.id, fecha };
    const [movimientos, encabezado] = await Promise.all([
      this.repo.movimientos(fecha, dia, db),
      this.repo.encabezado(dia, db),
    ]);
    const corte = armarCorte(movimientos, encabezado !== undefined);
    return {
      fecha,
      hoy,
      vendedor: { id: vendedor.id, nombre: vendedor.nombre },
      sucursal: { id: vendedor.sucursalId, codigo: vendedor.sucursalCodigo },
      lineas: corte.lineas.map((l) => ({
        presentacionId: l.presentacionId,
        nombre: l.nombre,
        cargadas: l.cargadas,
        vendidas: l.vendidas,
        regaladas: l.regaladas,
        deberiaRegresar: l.deberiaRegresar,
        buenas: l.buenas,
        merma: l.merma,
        faltante: l.faltante,
      })),
      totales: corte.totales,
      hecho: encabezado
        ? { en: encabezado.hechoEn, por: encabezado.hechoPor }
        : null,
    };
  }

  /** Fecha real y hasta hoy de Tijuana (D10); devuelve "hoy". */
  private async exigirFecha(fecha: string): Promise<string> {
    const hoy = await this.repo.hoyEnTijuana();
    if (!esFechaReal(fecha))
      throw new BadRequestException(MENSAJE_FECHA_INVALIDA);
    if (fecha > hoy) throw this.errorDeFecha([MENSAJE_FECHA_FUTURA], hoy);
    return hoy;
  }

  /** 400 con los mensajes y, como Retorno, el "hoy" de Tijuana. */
  private errorDeFecha(mensajes: string[], hoy: string): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: mensajes,
      hoyEnTijuana: hoy,
    });
  }

  /** El usuario con el codigo de su sucursal; 401 si ya no existe. */
  private async usuario(usuarioId: string) {
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    return usuario;
  }

  private async alcanceDe(usuarioId: string): Promise<Alcance> {
    return resolverAlcance((await this.usuario(usuarioId)).codigo, null);
  }

  /** Inexistente, dado de baja o de otra sucursal: el mismo 404. */
  private exigirAlcance(
    alcance: Alcance,
    vendedor: VendedorCorte | undefined,
  ): VendedorCorte {
    if (
      !vendedor ||
      (alcance.tipo === 'una' && alcance.codigo !== vendedor.sucursalCodigo)
    ) {
      throw new NotFoundException(MOTIVO_VENDEDOR_INEXISTENTE);
    }
    return vendedor;
  }
}
