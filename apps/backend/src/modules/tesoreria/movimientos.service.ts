import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { validarRango } from '../estadisticas/reglas-kilometraje';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import type {
  CrearMovimientoDto,
  EditarMovimientoDto,
  ListarMovimientosDto,
} from './dto/movimientos.dto';
import {
  MovimientosRepository,
  type DatosMovimiento,
} from './movimientos.repository';
import { esFechaValida, type MovimientoManual } from './reglas-saldo';
import { TesoreriaRepository } from './tesoreria.repository';
import { TesoreriaService } from './tesoreria.service';

@Injectable()
export class MovimientosService {
  constructor(
    private readonly repo: MovimientosRepository,
    private readonly tesoreriaRepo: TesoreriaRepository,
    private readonly tesoreria: TesoreriaService,
  ) {}

  async listar(
    usuarioId: string,
    q: ListarMovimientosDto,
  ): Promise<MovimientoManual[]> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const cuentas = await this.tesoreria.listarCuentas(
      usuarioId,
      normalizarSucursalPedida(q.sucursal),
    );
    return this.repo.listar(
      cuentas.map((c) => c.id),
      q.desde,
      q.hasta,
    );
  }

  async crear(
    usuarioId: string,
    dto: CrearMovimientoDto,
  ): Promise<MovimientoManual> {
    const datos: DatosMovimiento = {
      tipo: dto.tipo,
      fecha: dto.fecha,
      montoCentavos: dto.montoCentavos,
      cuentaId: dto.cuentaId,
      cuentaDestinoId: dto.cuentaDestinoId ?? null,
      comentario: dto.comentario ?? null,
    };
    await this.validar(usuarioId, datos);
    const id = await this.repo.crear(datos, usuarioId);
    return this.encontrado(id);
  }

  async editar(
    usuarioId: string,
    id: string,
    dto: EditarMovimientoDto,
  ): Promise<MovimientoManual> {
    // null en fecha/monto/cuentas = "no enviado"; en comentario, null o '' lo borra.
    if (
      dto.fecha == null &&
      dto.montoCentavos == null &&
      dto.cuentaId == null &&
      dto.cuentaDestinoId == null &&
      dto.comentario === undefined
    ) {
      throw new BadRequestException('No hay nada que actualizar.');
    }
    const actual = await this.modificable(usuarioId, id);
    const comentario =
      dto.comentario === undefined
        ? actual.comentario
        : dto.comentario?.trim() || null;
    const datos: DatosMovimiento = {
      tipo: actual.tipo,
      fecha: dto.fecha ?? actual.fecha,
      montoCentavos: dto.montoCentavos ?? actual.montoCentavos,
      cuentaId: dto.cuentaId ?? actual.cuentaId,
      cuentaDestinoId: dto.cuentaDestinoId ?? actual.cuentaDestinoId,
      comentario,
    };
    await this.validar(usuarioId, datos);
    await this.repo.actualizar(id, datos);
    return this.encontrado(id);
  }

  async eliminar(usuarioId: string, id: string): Promise<void> {
    await this.modificable(usuarioId, id);
    await this.repo.eliminar(id);
  }

  /** Vivo y con TODAS sus cuentas visibles para el usuario; si no, 404. */
  private async modificable(
    usuarioId: string,
    id: string,
  ): Promise<MovimientoManual> {
    const m = await this.repo.buscar(id);
    if (!m) throw new NotFoundException('No existe ese movimiento.');
    await this.cuentaDelMovimiento(usuarioId, m.cuentaId);
    if (m.cuentaDestinoId !== null)
      await this.cuentaDelMovimiento(usuarioId, m.cuentaDestinoId);
    return m;
  }

  /** Solo el 404 de la cuenta se traduce a "no existe el movimiento"; sesion o BD siguen su camino. */
  private async cuentaDelMovimiento(
    usuarioId: string,
    cuentaId: string,
  ): Promise<void> {
    await this.tesoreria
      .cuentaVisible(usuarioId, cuentaId)
      .catch((e: unknown) => {
        throw e instanceof NotFoundException
          ? new NotFoundException('No existe ese movimiento.')
          : e;
      });
  }

  /** Forma (spec §3.1) y alcance de las cuentas. */
  private async validar(usuarioId: string, d: DatosMovimiento): Promise<void> {
    if (!esFechaValida(d.fecha))
      throw new BadRequestException('La fecha no es válida.');
    if (d.fecha > (await this.tesoreriaRepo.hoyEnTijuana())) {
      throw new BadRequestException(
        'No se puede registrar un movimiento en una fecha futura.',
      );
    }
    if (d.tipo === 'traspaso') {
      if (d.cuentaDestinoId === null)
        throw new BadRequestException(
          'Elige la cuenta a la que entra el traspaso.',
        );
      if (d.cuentaDestinoId === d.cuentaId)
        throw new BadRequestException(
          'Un traspaso tiene que ser entre dos cuentas distintas.',
        );
    } else if (d.cuentaDestinoId !== null) {
      throw new BadRequestException('Solo un traspaso lleva cuenta destino.');
    }
    await this.tesoreria.cuentaVisible(usuarioId, d.cuentaId);
    if (d.cuentaDestinoId !== null)
      await this.tesoreria.cuentaVisible(usuarioId, d.cuentaDestinoId);
  }

  private async encontrado(id: string): Promise<MovimientoManual> {
    const m = await this.repo.buscar(id);
    if (!m) throw new NotFoundException('No existe ese movimiento.');
    return m;
  }
}
