import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { PreciosRepository } from '../cartera-clientes/precios.repository';
import { aPesos } from '../sincronizacion/dinero';
import {
  MOTIVO_NO_PERDIBLE,
  bloqueoDeEdicion,
  sePuedeMarcarPerdida,
} from './acciones-venta';
import { exigirAlcanceSobre } from './alcance-venta';
import { CobranzasRepository } from './cobranzas.repository';
import type { EditarVentaDto } from './dto/editar-venta.dto';
import {
  armarVentaEditada,
  pctComisionTrasEdicion,
  planDetalle,
} from './edicion-venta';
import { montoTotalCentavos, statusInicial } from './reglas-venta';
import { VentaRechazada } from './venta-rechazada';
import {
  VentasConsultaService,
  type VentaDetalle,
} from './ventas-consulta.service';
import {
  VentasEdicionRepository,
  type VentaBloqueada,
} from './ventas-edicion.repository';
import { VentasPortalRepository } from './ventas-portal.repository';
import { VentasRepository } from './ventas.repository';

/**
 * Editar, eliminar y marcar como cuenta perdida una venta desde el portal
 * (T-17 parte 2, §4.2-§4.4). Vale para ventas de la tablet y del portal: es la
 * via de correccion de todas.
 *
 * Cada operacion es UNA transaccion que empieza bloqueando la venta
 * (`for update`) y comprobando el alcance. El monto y el status se recalculan
 * con las reglas compartidas (`reglas-venta.ts`), como en el alta.
 */
@Injectable()
export class VentasEdicionService {
  constructor(
    private readonly repo: VentasEdicionRepository,
    private readonly portal: VentasPortalRepository,
    private readonly precios: PreciosRepository,
    private readonly ventas: VentasRepository,
    private readonly cobranzas: CobranzasRepository,
    private readonly consulta: VentasConsultaService,
  ) {}

  /** §4.2. Manda el ESTADO COMPLETO de lo editable. */
  async editar(
    usuarioId: string,
    id: string,
    dto: EditarVentaDto,
  ): Promise<VentaDetalle> {
    try {
      await this.portal.enTransaccion(async (trx) => {
        const venta = await this.bloquearConAlcance(usuarioId, id, trx);

        const bloqueo = bloqueoDeEdicion(
          venta.status,
          await this.repo.abonosDeCobroVivos(id, trx),
          'editar',
          { id: venta.facturaId, numero: venta.facturaNumero },
        );
        if (bloqueo) throw new ConflictException(bloqueo);

        const vendedorNuevo = dto.vendedorId?.toLowerCase() ?? null;
        if (vendedorNuevo === null && venta.origen === 'app') {
          throw new BadRequestException(
            'Una venta de tablet debe tener vendedor.',
          );
        }
        // Si no cambia, no se re-valida: la venta ya lo tiene, y un vendedor
        // dado de baja despues no puede impedir corregir sus ventas.
        if (
          vendedorNuevo !== null &&
          vendedorNuevo !== venta.vendedorId &&
          !(await this.portal.esRepartidorActivo(
            vendedorNuevo,
            venta.sucursalId,
            trx,
          ))
        ) {
          throw new BadRequestException(
            'El repartidor elegido no es un vendedor activo de la sucursal de la venta.',
          );
        }

        const guardadas = await this.repo.lineasGuardadas(id, trx);
        // Sin `vigenteHastaHoy`: una linea nueva vale lo que valia el dia de la venta.
        const precios = await this.precios.presentacionesConPrecio(
          venta.clienteId,
          venta.fecha,
          trx,
        );
        const armada = armarVentaEditada(
          {
            clienteId: venta.clienteId,
            numNota: dto.numNota ?? null,
            contadoCredito: dto.contadoCredito,
            factura: dto.factura,
            comentarios: dto.comentarios ?? null,
            lineas: dto.lineas,
          },
          guardadas,
          precios,
          venta.fecha,
        );
        if (!armada.ok) {
          if (armada.tipo === 'rechazo')
            throw new VentaRechazada(armada.rechazo);
          throw new BadRequestException(armada.motivo);
        }

        const nueva = armada.venta;
        const monto = montoTotalCentavos(nueva.lineas);
        const pctActual =
          vendedorNuevo !== null && vendedorNuevo !== venta.vendedorId
            ? await this.repo.pctComisionDelCliente(venta.clienteId, trx)
            : null;
        const metodo =
          dto.metodoPago ??
          (await this.repo.metodoCobroContado(id, trx)) ??
          'transferencia';

        // La cabecera primero: si el # de nota choca (23505), nada mas se escribio.
        await this.repo.actualizarCabecera(
          id,
          {
            vendedorId: vendedorNuevo,
            numNota: nueva.numNota,
            contadoCredito: nueva.contadoCredito,
            factura: nueva.factura,
            comentarios: nueva.comentarios,
            montoTotal: aPesos(monto),
            status: statusInicial(nueva.contadoCredito, monto),
            pctComision: pctComisionTrasEdicion(
              venta,
              vendedorNuevo,
              pctActual,
            ),
            usuarioId,
          },
          trx,
        );

        const plan = planDetalle(guardadas, nueva.lineas);
        await this.repo.borrarLineas(plan.borrar, trx);
        await this.repo.actualizarLineas(plan.actualizar, trx);
        if (plan.insertar.length > 0) {
          await this.ventas.insertarDetalle(
            id,
            plan.insertar.map((l) => ({
              presentacionId: l.presentacionId,
              cantidad: l.cantidad,
              cantidadPromocion: l.cantidadPromocion,
              precio: aPesos(l.precioCentavos),
            })),
            trx,
          );
        }

        // §4.2 paso 8: el cobro de contado se reescribe siempre; una
        // promocion ($0) no se cobra. Fecha = la de la venta; cobrador = el
        // repartidor (null en Oficina).
        await this.repo.borrarCobroContado(id, trx);
        if (nueva.contadoCredito === 'contado' && monto > 0) {
          await this.cobranzas.insertarAbono(
            {
              ventaNotaId: id,
              vendedorId: vendedorNuevo,
              fechaPago: venta.fecha,
              fechaOperacion: venta.fecha,
              monto: aPesos(monto),
              tipo: 'cobranza',
              saldoPendiente: aPesos(0),
              metodoPago: metodo,
              origen: 'venta_contado',
            },
            trx,
          );
        }
      });
    } catch (error) {
      // Kysely ya hizo rollback: aqui solo se traduce a HTTP.
      if (error instanceof VentaRechazada)
        throw new ConflictException(error.message);
      throw error;
    }
    return this.consulta.leerDetalle(id);
  }

  /** §4.3. Mismas condiciones que editar: viva y sin abonos de cobranza. */
  async eliminar(usuarioId: string, id: string): Promise<void> {
    await this.portal.enTransaccion(async (trx) => {
      const venta = await this.bloquearConAlcance(usuarioId, id, trx);
      const bloqueo = bloqueoDeEdicion(
        venta.status,
        await this.repo.abonosDeCobroVivos(id, trx),
        'eliminar',
        { id: venta.facturaId, numero: venta.facturaNumero },
      );
      if (bloqueo) throw new ConflictException(bloqueo);
      await this.repo.eliminarVenta(id, usuarioId, trx);
    });
  }

  /**
   * §4.4: aunque tenga abonos; deja de cobrarse el resto. Las reglas de
   * cobranza ya la tratan como no cobrable (`esCobrable`) y el pull de la
   * tablet solo baja `pendiente`/`abonado`. No hay deshacer en esta version.
   */
  async marcarCuentaPerdida(
    usuarioId: string,
    id: string,
  ): Promise<VentaDetalle> {
    await this.portal.enTransaccion(async (trx) => {
      const venta = await this.bloquearConAlcance(usuarioId, id, trx);
      if (!sePuedeMarcarPerdida(venta.status))
        throw new ConflictException(MOTIVO_NO_PERDIBLE);
      await this.repo.marcarCuentaPerdida(id, usuarioId, trx);
    });
    return this.consulta.leerDetalle(id);
  }

  /** 404 si no existe o esta eliminada; 403 si su sucursal es ajena. */
  private async bloquearConAlcance(
    usuarioId: string,
    id: string,
    trx: Transaction<DB>,
  ): Promise<VentaBloqueada> {
    const venta = await this.repo.bloquearVenta(id, trx);
    if (!venta) throw new NotFoundException('No existe esa venta.');
    exigirAlcanceSobre(
      await this.portal.buscarSucursalUsuario(usuarioId),
      venta.sucursalCodigo,
    );
    return venta;
  }
}
