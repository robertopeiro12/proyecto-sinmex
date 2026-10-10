import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import { esConflictoDeConcurrencia } from '../../database/errores-postgres';
import type { DB } from '../../database/schema';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { exigirAlcanceSobre } from './alcance-venta';
import {
  CobranzasPortalRepository,
  type ClienteParaCobro,
  type NotaPorCobrar,
} from './cobranzas-portal.repository';
import {
  CobranzasService,
  type NotasAPagar,
  type PlanDeCobro,
} from './cobranzas.service';
import type {
  AplicarSaldoFavorDto,
  PorCobrarDto,
  RegistrarCobroDto,
  VistaPreviaCobroDto,
} from './dto/cobranzas.dto';
import { PagoRechazado, type RazonPagoRechazado } from './pago-rechazado';
import { esFechaReal } from './venta-portal';
import { VentasPortalRepository } from './ventas-portal.repository';

export const MOTIVO_UN_FILTRO =
  'Busca por cliente, fecha o # de nota (uno solo).';
export const MOTIVO_FECHA_FUTURA = 'La fecha del pago no puede ser futura.';
export const MOTIVO_COBRADOR_INVALIDO =
  'El cobrador no es un repartidor activo de la sucursal del cliente.';
export const MOTIVO_INTERBLOQUEO_COBRO =
  'Otro usuario estaba modificando las notas de este cliente al mismo tiempo; vuelve a intentar.';

/**
 * El HTTP de cada rechazo del dominio. La fecha es un dato mal capturado
 * (400); lo demas es que la base cambio mientras la pantalla estaba abierta
 * (409).
 */
const HTTP_POR_RAZON: Record<RazonPagoRechazado, 400 | 409> = {
  'nota-ajena': 409,
  'nota-sin-saldo': 409,
  'fecha-anterior': 400,
  'saldo-favor-insuficiente': 409,
  'excede-lo-que-deben': 409,
};

/** `GET /cobranzas/por-cobrar?clienteId=` (§3.2). */
export interface ClientePorCobrar extends ClienteParaCobro {
  saldoFavorCentavos: number;
  notas: NotaPorCobrar[];
}

/** Lo que devuelven `POST /cobranzas` y `POST /cobranzas/saldo-favor`. */
export interface CobroRegistrado extends PlanDeCobro {
  /** Nombre del cliente, para el "Cobro registrado: $… a …". */
  cliente: string;
  montoCentavos: number;
}

type UsuarioConSucursal = Parameters<typeof exigirAlcanceSobre>[0];

const sinRepetir = (ids: string[]): string[] => [
  ...new Set(ids.map((id) => id.toLowerCase())),
];

/**
 * Cobranza desde el portal (T-21). Valida lo que no depende de la base, abre
 * UNA transaccion, exige el alcance sobre el cliente leido y llama a
 * `CobranzasService`, la misma regla que la tablet. **No emite folio**: la
 * cobranza no lleva folio (cliente, 2026-10-07).
 */
@Injectable()
export class CobranzasPortalService {
  constructor(
    private readonly cobranzas: CobranzasService,
    private readonly repo: CobranzasPortalRepository,
    private readonly portal: VentasPortalRepository,
  ) {}

  async porCobrar(
    usuarioId: string,
    dto: PorCobrarDto,
  ): Promise<ClientePorCobrar | NotaPorCobrar[]> {
    const clienteId = dto.clienteId ? dto.clienteId.toLowerCase() : null;
    const fecha = dto.fecha ? dto.fecha : null;
    const numNota = dto.numNota ? dto.numNota : null;
    if ([clienteId, fecha, numNota].filter((f) => f !== null).length !== 1)
      throw new BadRequestException(MOTIVO_UN_FILTRO);

    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);

    if (clienteId !== null) {
      const cliente = await this.repo.clienteParaCobro(clienteId);
      if (!cliente) throw new NotFoundException('No existe ese cliente.');
      exigirAlcanceSobre(usuario, cliente.sucursalCodigo);
      const [notas, saldoFavorCentavos] = await Promise.all([
        this.repo.notasPorCobrar({
          clienteId: cliente.id,
          fecha: null,
          numNota: null,
          sucursalCodigo: null,
        }),
        this.repo.saldoFavorCentavos(cliente.id),
      ]);
      return { ...cliente, saldoFavorCentavos, notas };
    }

    if (fecha !== null && !esFechaReal(fecha))
      throw new BadRequestException('Esa fecha no existe.');
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    // El query param es solo preferencia; pedir una sucursal ajena es 403.
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(dto.sucursal),
    );
    return this.repo.notasPorCobrar({
      clienteId: null,
      fecha,
      numNota,
      sucursalCodigo: alcance.tipo === 'una' ? alcance.codigo : null,
    });
  }

  /** §3.3: el reparto sin grabar, con las mismas comprobaciones que grabar. */
  async vistaPrevia(
    usuarioId: string,
    dto: VistaPreviaCobroDto,
  ): Promise<PlanDeCobro> {
    const pedido = this.pedido(dto);
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);
    return this.enTransaccion(async (trx) => {
      await this.clienteConAlcance(usuario, pedido.clienteId, trx);
      return dto.modo === 'saldo_favor'
        ? this.cobranzas.planearSaldoFavor(pedido, trx)
        : this.cobranzas.planearPago(pedido, trx);
    });
  }

  async registrar(
    usuarioId: string,
    dto: RegistrarCobroDto,
  ): Promise<CobroRegistrado> {
    if (!esFechaReal(dto.fechaPago))
      throw new BadRequestException('Esa fecha no existe.');
    const hoy = hoyEnTijuana();
    if (dto.fechaPago > hoy) throw new BadRequestException(MOTIVO_FECHA_FUTURA);

    const pedido = this.pedido(dto);
    const vendedorId = dto.vendedorId ? dto.vendedorId.toLowerCase() : null;
    // Fuera de la transaccion: dentro seria una segunda conexion abierta a la vez.
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);

    return this.enTransaccion(async (trx) => {
      const cliente = await this.clienteConAlcance(
        usuario,
        pedido.clienteId,
        trx,
      );
      if (
        vendedorId !== null &&
        !(await this.portal.esRepartidorActivo(
          vendedorId,
          cliente.sucursalId,
          trx,
        ))
      ) {
        throw new BadRequestException(MOTIVO_COBRADOR_INVALIDO);
      }
      const plan = await this.cobranzas.registrarPago(
        { ...pedido, metodoPago: dto.metodoPago, fechaPago: dto.fechaPago },
        {
          sucursalId: cliente.sucursalId,
          fechaOperacion: hoy,
          vendedorId,
          usuarioId,
        },
        trx,
      );
      return {
        cliente: cliente.nombre,
        montoCentavos: pedido.montoCentavos,
        ...plan,
      };
    });
  }

  /** §3.4: sin metodo ni cobrador; el dia es hoy en Tijuana. */
  async aplicarSaldoFavor(
    usuarioId: string,
    dto: AplicarSaldoFavorDto,
  ): Promise<CobroRegistrado> {
    const hoy = hoyEnTijuana();
    const pedido = this.pedido(dto);
    const usuario = await this.portal.buscarSucursalUsuario(usuarioId);

    return this.enTransaccion(async (trx) => {
      const cliente = await this.clienteConAlcance(
        usuario,
        pedido.clienteId,
        trx,
      );
      const plan = await this.cobranzas.aplicarSaldoFavor(
        pedido,
        {
          sucursalId: cliente.sucursalId,
          fechaOperacion: hoy,
          vendedorId: null,
          usuarioId,
        },
        trx,
      );
      return {
        cliente: cliente.nombre,
        montoCentavos: pedido.montoCentavos,
        ...plan,
      };
    });
  }

  /* ---------------------------------------------------------------- */

  private pedido(dto: {
    clienteId: string;
    notaIds: string[];
    montoCentavos: number;
  }): NotasAPagar {
    return {
      clienteId: dto.clienteId.toLowerCase(),
      notaIds: sinRepetir(dto.notaIds),
      montoCentavos: dto.montoCentavos,
    };
  }

  /** Se compara contra el cliente LEIDO, nunca contra un query param. */
  private async clienteConAlcance(
    usuario: UsuarioConSucursal,
    clienteId: string,
    trx: Transaction<DB>,
  ): Promise<ClienteParaCobro> {
    const cliente = await this.repo.clienteParaCobro(clienteId, trx);
    if (!cliente) throw new NotFoundException('No existe ese cliente.');
    exigirAlcanceSobre(usuario, cliente.sucursalCodigo);
    return cliente;
  }

  /**
   * UNA transaccion. Kysely ya hizo rollback cuando llega el `catch`: aqui solo
   * se traduce a HTTP. Un interbloqueo con un cobro de la tablet (o de otro
   * usuario) sale como 409, nunca como 500 (mismo trato que facturas).
   */
  private async enTransaccion<T>(
    tarea: (trx: Transaction<DB>) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.portal.enTransaccion(tarea);
    } catch (error) {
      if (error instanceof PagoRechazado)
        throw HTTP_POR_RAZON[error.razon] === 400
          ? new BadRequestException(error.message)
          : new ConflictException(error.message);
      if (esConflictoDeConcurrencia(error))
        throw new ConflictException(MOTIVO_INTERBLOQUEO_COBRO);
      throw error;
    }
  }
}
