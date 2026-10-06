import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PreciosRepository } from '../cartera-clientes/precios.repository';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import type { RegistrarVentaDto } from './dto/registrar-venta.dto';
import { FoliosOficinaAgotados } from './folio-oficina';
import { FoliosOficinaRepository } from './folios-oficina.repository';
import { esNotaDuplicada, motivoNotaDuplicada } from './nota-duplicada';
import { armarVentaPortal, revisarFechaVenta } from './venta-portal';
import { VentaRechazada } from './venta-rechazada';
import {
  VentasPortalRepository,
  type Repartidor,
} from './ventas-portal.repository';
import { VentasService } from './ventas.service';
import type { StatusInicial } from './reglas-venta';

/** Una presentacion del cliente con su precio a la fecha; `null` = "sin precio en la lista" (§3). */
export interface PresentacionDeCatalogo {
  presentacionId: string;
  producto: string;
  volumen: string;
  precioCentavos: number | null;
}

/** Lo que el portal muestra al grabar (§3, paso 6). */
export interface VentaRegistradaPortal {
  id: string;
  folio: string;
  montoCentavos: number;
  status: StatusInicial;
}

/**
 * La venta que captura la oficina en el portal (T-17, §4).
 *
 * Valida lo que es propio del portal (alcance del usuario, repartidor, fecha,
 * precio del servidor), emite el folio OF y entra por el MISMO
 * `VentasService.registrarVenta` que la tablet: el monto se calcula en un solo
 * lugar.
 */
@Injectable()
export class VentasPortalService {
  constructor(
    private readonly repo: VentasPortalRepository,
    private readonly precios: PreciosRepository,
    private readonly ventas: VentasService,
    private readonly folios: FoliosOficinaRepository,
  ) {}

  async catalogo(
    usuarioId: string,
    clienteId: string,
    fecha: string | undefined,
  ): Promise<PresentacionDeCatalogo[]> {
    const dia = fecha ?? '';
    const errorFecha = revisarFechaVenta(dia, hoyEnTijuana());
    if (errorFecha) throw new BadRequestException(errorFecha);

    const cliente = await this.repo.clienteDeVenta(clienteId);
    if (!cliente) throw new NotFoundException('No existe ese cliente.');
    await this.exigirAlcance(usuarioId, cliente.sucursalCodigo);

    return this.repo.enTransaccion(async (trx) => {
      // Sin `vigenteHastaHoy`: el precio de ESA fecha, el mismo que cobrara POST.
      const precios = await this.precios.presentacionesConPrecio(
        clienteId,
        dia,
        trx,
      );
      const nombres = await this.repo.nombresDePresentaciones(
        [...precios.keys()],
        trx,
      );
      return [...precios]
        .flatMap(([presentacionId, precioCentavos]) => {
          const nombre = nombres.get(presentacionId);
          return nombre ? [{ presentacionId, ...nombre, precioCentavos }] : [];
        })
        .sort(
          (a, b) =>
            a.producto.localeCompare(b.producto, 'es') ||
            a.volumen.localeCompare(b.volumen, 'es'),
        );
    });
  }

  /** "Oficina" lo agrega la pantalla, no el servidor (§4.1). */
  async repartidores(
    usuarioId: string,
    sucursalId: string,
  ): Promise<Repartidor[]> {
    const codigo = await this.repo.codigoDeSucursal(sucursalId);
    if (codigo === undefined)
      throw new NotFoundException('No existe esa sucursal.');
    await this.exigirAlcance(usuarioId, codigo);
    return this.repo.repartidoresActivos(sucursalId);
  }

  /** §4.2: todo en una transaccion; si algo falla, ni venta ni folio ni cobro. */
  async registrar(
    usuarioId: string,
    dto: RegistrarVentaDto,
  ): Promise<VentaRegistradaPortal> {
    const errorFecha = revisarFechaVenta(dto.fecha, hoyEnTijuana());
    if (errorFecha) throw new BadRequestException(errorFecha);

    try {
      return await this.repo.enTransaccion(async (trx) => {
        const cliente = await this.repo.clienteDeVenta(dto.clienteId, trx);
        if (!cliente) throw new NotFoundException('No existe ese cliente.');
        await this.exigirAlcance(usuarioId, cliente.sucursalCodigo);

        if (
          dto.vendedorId !== null &&
          !(await this.repo.esRepartidorActivo(
            dto.vendedorId,
            cliente.sucursalId,
            trx,
          ))
        ) {
          throw new BadRequestException(
            'El repartidor elegido no es un vendedor activo de la sucursal del cliente.',
          );
        }

        const precios = await this.precios.presentacionesConPrecio(
          dto.clienteId,
          dto.fecha,
          trx,
        );
        const armada = armarVentaPortal(
          {
            clienteId: dto.clienteId,
            numNota: dto.numNota,
            contadoCredito: dto.contadoCredito,
            factura: dto.factura,
            comentarios: dto.comentarios ?? null,
            lineas: dto.lineas,
          },
          precios,
          dto.fecha,
        );
        if (!armada.ok) {
          if (armada.tipo === 'rechazo')
            throw new VentaRechazada(armada.rechazo);
          throw new BadRequestException(armada.motivo);
        }

        // Despues de todas las validaciones y dentro de la transaccion: un
        // rechazo posterior (p. ej. el # de nota) hace rollback del contador.
        const folio = await this.folios.emitir(
          { id: cliente.sucursalId, codigo: cliente.sucursalCodigo },
          dto.fecha,
          trx,
        );

        const registrada = await this.ventas.registrarVenta(
          armada.venta,
          {
            sucursalId: cliente.sucursalId,
            fechaOperacion: dto.fecha,
            vendedorId: dto.vendedorId,
            folio,
            usuarioId,
            origen: 'portal',
            metodoPagoContado: dto.metodoPago ?? 'transferencia',
          },
          trx,
        );
        return {
          id: registrada.id,
          folio,
          montoCentavos: registrada.montoCentavos,
          status: registrada.status,
        };
      });
    } catch (error) {
      // Kysely ya hizo rollback: aqui solo se traduce a HTTP.
      if (error instanceof VentaRechazada)
        throw new ConflictException(error.message);
      if (error instanceof FoliosOficinaAgotados)
        throw new ConflictException(error.message);
      if (esNotaDuplicada(error)) {
        // El DTO ya recorto el # de nota: es el mismo texto que choco.
        throw new ConflictException(motivoNotaDuplicada(dto.numNota));
      }
      throw error;
    }
  }

  /** Misma doctrina que `ClientesService.obtener`: el alcance se compara con la sucursal YA LEIDA. */
  private async exigirAlcance(
    usuarioId: string,
    codigoSucursal: string,
  ): Promise<void> {
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(fila.codigo, null);
    if (alcance.tipo === 'una' && alcance.codigo !== codigoSucursal) {
      throw new ForbiddenException('No tienes acceso a esa sucursal.');
    }
  }
}
