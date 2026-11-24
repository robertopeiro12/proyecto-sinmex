import { isUUID } from 'class-validator';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import {
  CortesRepository,
  type MovimientoVendedor,
  type RecargaDelDia,
} from './cortes.repository';
import { MOTIVO_VENDEDOR_INEXISTENTE } from './cortes.service';
import type { ConsultaInventarioVendedorDto } from './dto/inventario-vendedor.dto';
import {
  armarCorte,
  type EstadoCorte,
  type TotalesCorte,
} from './reglas-corte';
import {
  sumarVendedores,
  type LineaSumada,
} from './reglas-inventario-vendedor';
import {
  esFechaReal,
  MENSAJE_FECHA_FUTURA,
  MENSAJE_FECHA_INVALIDA,
} from './reglas-comunes';

export const MOTIVO_ELIGE_SUCURSAL = 'Elige una sucursal.';
export const MOTIVO_SUCURSAL_INEXISTENTE = 'No existe esa sucursal.';
export const MOTIVO_VENDEDOR_INVALIDO = 'Elige un vendedor válido.';

/** Una recarga (linea de carga) del dia, como la recibe el portal. */
export type RecargaInventario = RecargaDelDia;

/**
 * Una presentacion de la pantalla (los campos del corte). La validacion por
 * almacen es `null` si el corte no esta hecho (D4); con "todos", si ningun
 * vendedor con corte tuvo esa presentacion (D3). Con un solo vendedor la
 * teorica (`deberiaRegresar`, `mermaTeorica`) sale aunque no haya corte.
 */
export type LineaInventario = Pick<
  LineaSumada,
  | 'presentacionId'
  | 'nombre'
  | 'producto'
  | 'volumen'
  | 'cargadas'
  | 'vendidas'
  | 'regaladas'
  | 'mermaEntregada'
  | 'mermaRecibida'
  | 'mermaAlmacen'
  | 'consumo'
  | 'cambiosEntregados'
  | 'cambiosRecibidos'
  | 'deberiaRegresar'
  | 'buenas'
  | 'faltante'
  | 'merma'
  | 'mermaTeorica'
  | 'resultadoMerma'
>;

/** `GET /inventario-vendedor`. */
export interface InventarioVendedor {
  fecha: string;
  hoy: string;
  sucursal: { id: string; codigo: string };
  vendedor: { id: string; nombre: string } | null;
  lineas: LineaInventario[];
  totales: TotalesCorte;
  recargas: RecargaInventario[];
  vendedoresSinCorte: number;
  /** Solo con un vendedor; con "todos", `null`. */
  corte: {
    estado: EstadoCorte;
    piezasFaltantes: number | null;
    mermaFaltante: number | null;
  } | null;
}

const aPantalla = (l: LineaSumada): LineaInventario => ({
  presentacionId: l.presentacionId,
  nombre: l.nombre,
  producto: l.producto,
  volumen: l.volumen,
  cargadas: l.cargadas,
  vendidas: l.vendidas,
  regaladas: l.regaladas,
  mermaEntregada: l.mermaEntregada,
  mermaRecibida: l.mermaRecibida,
  mermaAlmacen: l.mermaAlmacen,
  consumo: l.consumo,
  cambiosEntregados: l.cambiosEntregados,
  cambiosRecibidos: l.cambiosRecibidos,
  deberiaRegresar: l.deberiaRegresar,
  buenas: l.buenas,
  faltante: l.faltante,
  merma: l.merma,
  mermaTeorica: l.mermaTeorica,
  resultadoMerma: l.resultadoMerma,
});

/**
 * Inventario, merma y recargas de un vendedor (o de toda una sucursal) en un
 * dia. Solo lectura: la cuenta es la del corte (`armarCorte`), aqui no se
 * recalcula nada. Alcance como `CortesService`: sucursal ajena 403, vendedor
 * ajeno o dado de baja 404, fecha futura 400 con `hoyEnTijuana`.
 */
@Injectable()
export class InventarioVendedorService {
  constructor(private readonly repo: CortesRepository) {}

  async leer(
    usuarioId: string,
    q: ConsultaInventarioVendedorDto,
  ): Promise<InventarioVendedor> {
    const hoy = await this.repo.hoyEnTijuana();
    if (!esFechaReal(q.fecha))
      throw new BadRequestException(MENSAJE_FECHA_INVALIDA);
    if (q.fecha > hoy) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: [MENSAJE_FECHA_FUTURA],
        hoyEnTijuana: hoy,
      });
    }
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );

    const pedido = q.vendedor.toLowerCase();
    if (pedido !== 'todos' && !isUUID(pedido))
      throw new BadRequestException(MOTIVO_VENDEDOR_INVALIDO);
    if (pedido === 'todos') {
      if (alcance.tipo !== 'una')
        throw new BadRequestException(MOTIVO_ELIGE_SUCURSAL);
      return this.todos(q.fecha, hoy, alcance.codigo);
    }

    const vendedor = await this.repo.vendedor(pedido);
    if (
      !vendedor ||
      (alcance.tipo === 'una' && alcance.codigo !== vendedor.sucursalCodigo)
    ) {
      throw new NotFoundException(MOTIVO_VENDEDOR_INEXISTENTE);
    }
    const dia = { vendedorId: vendedor.id, fecha: q.fecha };
    const [movimientos, encabezado, recargas] = await Promise.all([
      this.repo.movimientos(q.fecha, dia),
      this.repo.encabezado(dia),
      this.repo.recargas(q.fecha, { vendedorId: vendedor.id }),
    ]);
    const hecho = encabezado !== undefined;
    const corte = armarCorte(movimientos, hecho);
    // Un vendedor sin corte tiene los resultados vacios, no en 0 (D4).
    const suma = sumarVendedores(
      [{ lineas: corte.lineas, totales: corte.totales, hecho }],
      { teoricaSinCorte: true },
    );
    return {
      fecha: q.fecha,
      hoy,
      sucursal: { id: vendedor.sucursalId, codigo: vendedor.sucursalCodigo },
      vendedor: { id: vendedor.id, nombre: vendedor.nombre },
      lineas: suma.lineas.map(aPantalla),
      totales: corte.totales,
      recargas,
      vendedoresSinCorte: 0,
      corte: {
        estado: corte.estado,
        piezasFaltantes: corte.totales.faltante,
        mermaFaltante: corte.totales.faltanteMerma,
      },
    };
  }

  private async todos(
    fecha: string,
    hoy: string,
    codigo: string,
  ): Promise<InventarioVendedor> {
    const sucursal = await this.repo.sucursalPorCodigo(codigo);
    if (!sucursal) throw new NotFoundException(MOTIVO_SUCURSAL_INEXISTENTE);
    const [movimientos, recargas] = await Promise.all([
      this.repo.movimientos(fecha, { sucursalCodigo: codigo }),
      this.repo.recargas(fecha, { sucursalCodigo: codigo }),
    ]);
    const porVendedor = new Map<string, MovimientoVendedor[]>();
    for (const m of movimientos) {
      const lista = porVendedor.get(m.vendedorId) ?? [];
      lista.push(m);
      porVendedor.set(m.vendedorId, lista);
    }
    const vendedores = await this.repo.vendedoresDelDia(fecha, codigo, [
      ...porVendedor.keys(),
    ]);
    const cortes = vendedores.map((v) => {
      const hecho = v.hechoEn !== null;
      const c = armarCorte(porVendedor.get(v.id) ?? [], hecho);
      return { lineas: c.lineas, totales: c.totales, hecho };
    });
    const suma = sumarVendedores(cortes);
    return {
      fecha,
      hoy,
      sucursal,
      vendedor: null,
      lineas: suma.lineas.map(aPantalla),
      totales: suma.totales,
      recargas,
      vendedoresSinCorte: suma.vendedoresSinCorte,
      corte: null,
    };
  }
}
