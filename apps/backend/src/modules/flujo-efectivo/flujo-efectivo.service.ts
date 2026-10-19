import { BadRequestException, Injectable } from '@nestjs/common';
import { validarRango } from '../estadisticas/reglas-kilometraje';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { TesoreriaService } from '../tesoreria/tesoreria.service';
import type { FlujoEfectivoDto } from './dto/flujo-efectivo.dto';
import {
  FlujoEfectivoRepository,
  type ComentarioIngreso,
} from './flujo-efectivo.repository';
import { armarResumen, type ResumenFlujo } from './reglas-flujo';

export type { ComentarioIngreso };

export interface ComentarioEgreso {
  fecha: string;
  concepto: 'Retiro' | 'Traspaso';
  cuenta: string;
  montoCentavos: number;
  comentario: string;
}

export interface FlujoEfectivo extends ResumenFlujo {
  desde: string;
  hasta: string;
  totalTesoreriaCentavos: number;
  tesoreriaCuentasConSaldo: number;
  tesoreriaCuentas: number;
  comentarios: {
    ingresos: ComentarioIngreso[];
    egresos: ComentarioEgreso[];
  };
}

/** T-32: Flujo de Efectivo, solo lectura (spec §3). */
@Injectable()
export class FlujoEfectivoService {
  constructor(
    private readonly repo: FlujoEfectivoRepository,
    private readonly tesoreria: TesoreriaService,
  ) {}

  async flujo(usuarioId: string, q: FlujoEfectivoDto): Promise<FlujoEfectivo> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const usuario = await this.tesoreria.usuario(usuarioId);
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(q.sucursal),
    );
    const codigo = alcance.tipo === 'todas' ? null : alcance.codigo;

    const [ventas, cobros, ingresos, vista] = await Promise.all([
      this.repo.ventasPorDia(q.desde, q.hasta, codigo),
      this.repo.cobradasPorDia(q.desde, q.hasta, codigo),
      this.repo.comentariosDeVentas(q.desde, q.hasta, codigo),
      this.tesoreria.vista(usuarioId, {
        desde: q.desde,
        hasta: q.hasta,
        sucursal: q.sucursal,
      }),
    ]);

    const egresos: ComentarioEgreso[] = [];
    for (const e of vista.eventos) {
      if (e.tipo !== 'retiro' && e.tipo !== 'traspaso') continue;
      if (e.comentario === null) continue;
      const traspaso = e.tipo === 'traspaso';
      egresos.push({
        fecha: e.fecha,
        concepto: traspaso ? 'Traspaso' : 'Retiro',
        cuenta: traspaso
          ? `${e.cuentaNombre} → ${e.cuentaDestinoNombre}`
          : e.cuentaNombre,
        montoCentavos: e.montoCentavos,
        comentario: e.comentario,
      });
    }

    return {
      ...armarResumen(ventas, cobros),
      desde: q.desde,
      hasta: q.hasta,
      totalTesoreriaCentavos: vista.total.saldoFinalCentavos,
      tesoreriaCuentasConSaldo: vista.total.cuentasConSaldoFinal,
      tesoreriaCuentas: vista.total.cuentas,
      comentarios: { ingresos, egresos },
    };
  }
}
