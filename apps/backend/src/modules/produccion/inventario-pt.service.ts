import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
  type Alcance,
} from '../sucursales/alcance-sucursal';
import { CortesRepository } from './cortes.repository';
import type {
  ConsultaAjustesPtDto,
  ConsultaDescuentosPtDto,
  ConsultaHistorialPtDto,
  ConsultaInventarioPtDto,
  GuardarAjustesPtDto,
} from './dto/inventario-pt.dto';
import {
  InventarioPtRepository,
  type AjusteFila,
  type DescuentoFila,
  type PresentacionPt,
} from './inventario-pt.repository';
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
  MOTIVO_PRESENTACION_INEXISTENTE,
} from './reglas-comunes';
import { mermaTeorica } from './reglas-corte';
import {
  compararPresentaciones,
  largoDelRango,
  ordenarPorPresentacion,
  porProducto,
  serie,
  SIN_MOVIMIENTOS,
  sumarMovimientos,
  sumarRenglones,
  validarAjustes,
  type DiaPt,
  type MovimientosDia,
  type RenglonPt,
} from './reglas-inventario-pt';

export const MAX_DIAS_HISTORIAL = 62;
export const MOTIVO_ELIGE_SUCURSAL = 'Elige una sucursal.';
export const MOTIVO_SUCURSAL_INEXISTENTE = 'No existe esa sucursal.';
export const MOTIVO_PRESENTACION_O_PRODUCTO =
  'Elige una presentación o un producto.';
export const MOTIVO_PRESENTACION_NO_EXISTE = 'No existe esa presentación.';
export const MOTIVO_PRODUCTO_NO_EXISTE = 'No existe ese producto.';
export const MENSAJE_RANGO_INVERTIDO =
  'La fecha inicial no puede ser posterior a la final.';
export const MENSAJE_RANGO_LARGO = `El historial no puede pasar de ${MAX_DIAS_HISTORIAL} días.`;
export const MENSAJE_COMENTARIO_AJUSTE =
  'El comentario no puede pasar de 300 caracteres.';

/** `GET /inventario-pt`. */
export interface InventarioPt {
  fecha: string;
  hoyEnTijuana: string;
  renglones: RenglonPt[];
}

/** `GET /inventario-pt/historial`: un renglon por dia del rango, del mas viejo al mas nuevo. */
export interface HistorialPt {
  dias: (RenglonPt & { fecha: string })[];
}

/** `GET /inventario-pt/descuentos`. */
export interface DescuentosPt {
  detalle: DescuentoFila[];
}

/** Un renglon de la precarga de "Ajustar inventario". `null` = sin inventario inicial. */
export interface RenglonAjustePt {
  presentacionId: string;
  productoId: string;
  producto: string;
  volumen: string;
  inventarioInicial: number | null;
  mermaAcumuladaInicial: number | null;
  ajustado: boolean;
}

/** `GET /inventario-pt/ajustes`. */
export interface AjustesPt {
  fecha: string;
  hoyEnTijuana: string;
  renglones: RenglonAjustePt[];
}

/** Las sucursales que se suman: una, o todas las vivas. */
interface Ambito {
  sucursalIds: string[];
  /** `null` = todas. */
  codigo: string | null;
}

const clave = (...partes: string[]) => partes.join('|');

const identidad = (p: PresentacionPt) => ({
  presentacionId: p.presentacionId,
  productoId: p.productoId,
  producto: p.producto,
  volumen: p.volumen,
});

/**
 * Inventario de PT con Ventas (spec 2026-11-25, D2–D5): solo lectura salvo los
 * ajustes. La cuenta vive en `reglas-inventario-pt.ts`; aqui se juntan las
 * fuentes por rango (sin un query por dia) y se resuelve el alcance como el
 * corte: atado a otra sucursal = 403, `todas` = la suma de las sucursales vivas
 * (solo en las lecturas), fecha futura = 400 con `hoyEnTijuana`.
 */
@Injectable()
export class InventarioPtService {
  constructor(
    private readonly repo: InventarioPtRepository,
    private readonly cortes: CortesRepository,
  ) {}

  async leer(
    usuarioId: string,
    q: ConsultaInventarioPtDto,
  ): Promise<InventarioPt> {
    const hoy = await this.exigirFecha(q.fecha);
    const ambito = await this.ambito(usuarioId, q.sucursal);
    const series = await this.calcular(ambito, null, q.fecha, q.fecha);
    const renglones = series.map(({ presentacion, dias }) => ({
      ...identidad(presentacion),
      ...sinFecha(dias[0]),
    }));
    return {
      fecha: q.fecha,
      hoyEnTijuana: hoy,
      renglones:
        q.vista === 'producto'
          ? porProducto(renglones)
          : ordenarPorPresentacion(renglones),
    };
  }

  async historial(
    usuarioId: string,
    q: ConsultaHistorialPtDto,
  ): Promise<HistorialPt> {
    const hoy = await this.hoy();
    if (!esFechaReal(q.desde) || !esFechaReal(q.hasta))
      throw new BadRequestException(MENSAJE_FECHA_INVALIDA);
    if (q.hasta > hoy) throw this.fechaFutura(hoy);
    if (q.desde > q.hasta)
      throw new BadRequestException(MENSAJE_RANGO_INVERTIDO);
    if (largoDelRango(q.desde, q.hasta) > MAX_DIAS_HISTORIAL)
      throw new BadRequestException(MENSAJE_RANGO_LARGO);
    const objetivo = await this.objetivo(q);
    const ambito = await this.ambito(usuarioId, q.sucursal);
    const series = await this.calcular(ambito, objetivo, q.desde, q.hasta);
    if (series.length === 0) return { dias: [] };
    const dias = series[0].dias.map((_, i) => {
      const renglones: RenglonPt[] = series.map(({ presentacion, dias }) => ({
        ...identidad(presentacion),
        ...sinFecha(dias[i]),
      }));
      const fila: RenglonPt = q.presentacion
        ? renglones[0]
        : { ...sumarRenglones(renglones), presentacionId: null, volumen: '' };
      return { fecha: series[0].dias[i].fecha, ...fila };
    });
    return { dias };
  }

  async descuentos(
    usuarioId: string,
    q: ConsultaDescuentosPtDto,
  ): Promise<DescuentosPt> {
    await this.exigirFecha(q.fecha);
    const objetivo = await this.objetivo(q);
    const ambito = await this.ambito(usuarioId, q.sucursal);
    return {
      detalle: await this.repo.descuentos(
        ambito.sucursalIds,
        objetivo.map((p) => p.presentacionId),
        q.fecha,
      ),
    };
  }

  /** La precarga de "Ajustar inventario": lo que el sistema calcula al inicio del dia, o el ajuste. */
  async ajustesDelDia(
    usuarioId: string,
    q: ConsultaAjustesPtDto,
  ): Promise<AjustesPt> {
    const hoy = await this.exigirFecha(q.fecha);
    const ambito = await this.ambito(usuarioId, q.sucursal, true);
    const series = await this.calcular(ambito, null, q.fecha, q.fecha);
    const renglones = series.map(({ presentacion, dias }) => {
      const d = dias[0];
      return {
        ...identidad(presentacion),
        inventarioInicial: d.inicial,
        // La merma acumulada de arranque: la del dia sin lo que se movio ese dia.
        mermaAcumuladaInicial:
          d.mermaAcumulada === null
            ? null
            : d.mermaAcumulada - d.merma + d.retiroMerma,
        ajustado: d.ajustado,
      };
    });
    return {
      fecha: q.fecha,
      hoyEnTijuana: hoy,
      renglones: renglones.sort(compararPresentaciones),
    };
  }

  /** `PUT /inventario-pt/ajustes`: crea o corrige el ajuste de cada renglon, todo o nada. */
  async guardarAjustes(
    usuarioId: string,
    dto: GuardarAjustesPtDto,
  ): Promise<void> {
    const hoy = await this.hoy();
    const mensajes = validarAjustes(dto, hoy);
    const comentario = dto.comentario?.trim() || null;
    if (comentario !== null && comentario.length > 300)
      mensajes.push(MENSAJE_COMENTARIO_AJUSTE);
    if (mensajes.length > 0) throw new BadRequestException(mensajes);
    const ambito = await this.ambito(usuarioId, dto.sucursal, true);
    const vivas = new Set(
      (await this.repo.presentaciones([])).map((p) => p.presentacionId),
    );
    const renglones = dto.renglones.map((r) => ({
      ...r,
      presentacionId: r.presentacionId.toLowerCase(),
    }));
    if (renglones.some((r) => !vivas.has(r.presentacionId)))
      throw new BadRequestException(MOTIVO_PRESENTACION_INEXISTENTE);
    await this.repo.guardarAjustes(
      ambito.sucursalIds[0],
      dto.fecha,
      renglones,
      comentario,
      usuarioId,
    );
  }

  /**
   * La serie de cada presentacion de `[desde, hasta]`, sumada sobre las
   * sucursales del ambito. Con `objetivo = null`: las presentaciones vivas mas
   * las que tuvieron movimiento en el rango o un ajuste que las encadena.
   */
  private async calcular(
    ambito: Ambito,
    objetivo: PresentacionPt[] | null,
    desde: string,
    hasta: string,
  ): Promise<{ presentacion: PresentacionPt; dias: DiaPt[] }[]> {
    const ids = objetivo ? objetivo.map((p) => p.presentacionId) : null;
    const ajustes = await this.repo.ajustes(
      ambito.sucursalIds,
      desde,
      hasta,
      ids,
    );
    // Se encadena desde el ajuste mas viejo que haga falta.
    const inicio = ajustes.reduce(
      (min, a) => (a.fecha < min ? a.fecha : min),
      desde,
    );
    const [movimientos, vendedores, hechos] = await Promise.all([
      this.repo.movimientos(ambito.sucursalIds, inicio, hasta, ids),
      this.repo.movimientosVendedores(ambito.codigo, inicio, hasta),
      this.repo.cortesHechos(inicio, hasta),
    ]);

    const enAmbito = new Set(ambito.sucursalIds);
    const porClave = new Map<string, Map<string, MovimientosDia>>();
    const agregar = (
      sucursalId: string,
      presentacionId: string,
      fecha: string,
      m: MovimientosDia,
    ) => {
      const k = clave(sucursalId, presentacionId);
      const dias = porClave.get(k) ?? new Map<string, MovimientosDia>();
      dias.set(fecha, sumarMovimientos(dias.get(fecha) ?? SIN_MOVIMIENTOS, m));
      porClave.set(k, dias);
    };
    const conMovimiento = new Set<string>();
    for (const m of movimientos) {
      agregar(m.sucursalId, m.presentacionId, m.fecha, m);
      if (m.fecha >= desde) conMovimiento.add(m.presentacionId);
    }
    // Merma de los vendedores: la contada si el corte esta hecho; si no, la teorica.
    for (const v of vendedores) {
      if (!enAmbito.has(v.sucursalId)) continue;
      if (ids && !ids.includes(v.presentacionId)) continue;
      const hecho = hechos.has(clave(v.vendedorId, v.fecha));
      const merma = hecho ? v.merma : mermaTeorica(v);
      if (merma === 0) continue;
      agregar(v.sucursalId, v.presentacionId, v.fecha, {
        ...SIN_MOVIMIENTOS,
        merma,
      });
      if (v.fecha >= desde) conMovimiento.add(v.presentacionId);
    }

    const ajustesPor = new Map<string, AjusteFila[]>();
    for (const a of ajustes) {
      const k = clave(a.sucursalId, a.presentacionId);
      ajustesPor.set(k, [...(ajustesPor.get(k) ?? []), a]);
    }

    const presentaciones =
      objetivo ??
      (await this.repo.presentaciones([
        ...conMovimiento,
        ...ajustes.map((a) => a.presentacionId),
      ]));
    if (ambito.sucursalIds.length === 0) return [];
    return presentaciones.map((p) => {
      const porSucursal = ambito.sucursalIds.map((s) =>
        serie(
          ajustesPor.get(clave(s, p.presentacionId)) ?? [],
          porClave.get(clave(s, p.presentacionId)) ?? new Map(),
          desde,
          hasta,
        ),
      );
      const dias = porSucursal[0].map((d, i) =>
        porSucursal.length === 1
          ? d
          : sumarRenglones(porSucursal.map((serieSuc) => serieSuc[i])),
      );
      return { presentacion: p, dias };
    });
  }

  /** La presentacion pedida o las del producto pedido (exactamente uno). */
  private async objetivo(q: {
    presentacion?: string;
    producto?: string;
  }): Promise<PresentacionPt[]> {
    if ((q.presentacion === undefined) === (q.producto === undefined))
      throw new BadRequestException(MOTIVO_PRESENTACION_O_PRODUCTO);
    if (q.presentacion) {
      const p = await this.repo.presentacion(q.presentacion.toLowerCase());
      if (!p) throw new NotFoundException(MOTIVO_PRESENTACION_NO_EXISTE);
      return [p];
    }
    const todas = await this.repo.presentacionesDeProducto(
      (q.producto as string).toLowerCase(),
    );
    if (todas.length === 0)
      throw new NotFoundException(MOTIVO_PRODUCTO_NO_EXISTE);
    // Las dadas de baja no se suman: con "Por producto" la pantalla suma las vivas.
    const vivas = todas.filter((p) => p.viva);
    return vivas.length > 0 ? vivas : todas;
  }

  /** Las sucursales del alcance. `soloUna`: `todas` = 400 (ajustes). */
  private async ambito(
    usuarioId: string,
    sucursal: string | undefined,
    soloUna = false,
  ): Promise<Ambito> {
    const usuario = await this.cortes.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    const alcance: Alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(sucursal),
    );
    if (alcance.tipo === 'todas') {
      if (soloUna) throw new BadRequestException(MOTIVO_ELIGE_SUCURSAL);
      const vivas = await this.repo.sucursalesVivas();
      return { sucursalIds: vivas.map((s) => s.id), codigo: null };
    }
    const s = await this.cortes.sucursalPorCodigo(alcance.codigo);
    if (!s) throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
    return { sucursalIds: [s.id], codigo: s.codigo };
  }

  private hoy(): Promise<string> {
    return this.cortes.hoyEnTijuana();
  }

  private fechaFutura(hoy: string): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: [MENSAJE_FECHA_FUTURA],
      hoyEnTijuana: hoy,
    });
  }

  /** La fecha existe y no es futura; devuelve hoy en Tijuana. */
  private async exigirFecha(fecha: string): Promise<string> {
    const hoy = await this.hoy();
    if (!esFechaReal(fecha))
      throw new BadRequestException(MENSAJE_FECHA_INVALIDA);
    if (fecha > hoy) throw this.fechaFutura(hoy);
    return hoy;
  }
}

/** Un dia de la serie sin su fecha (la pantalla del dia no la repite por renglon). */
function sinFecha(d: DiaPt): Omit<DiaPt, 'fecha'> {
  const resto: Partial<DiaPt> = { ...d };
  delete resto.fecha;
  return resto as Omit<DiaPt, 'fecha'>;
}
