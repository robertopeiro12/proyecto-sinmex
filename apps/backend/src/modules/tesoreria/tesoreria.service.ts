import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { validarRango } from '../estadisticas/reglas-kilometraje';
import {
  normalizarSucursalPedida,
  resolverAlcance,
  type Alcance,
} from '../sucursales/alcance-sucursal';
import type {
  CrearCuentaDto,
  GuardarSaldosDto,
  RenombrarCuentaDto,
  VistaTesoreriaDto,
} from './dto/tesoreria.dto';
import {
  armarVista,
  esFechaValida,
  type CuentaEnAlcance,
  type SaldoFijado,
  type VistaTesoreria,
} from './reglas-saldo';
import { CobranzaTesoreriaRepository } from './cobranza-tesoreria.repository';
import { GastosTesoreriaRepository } from './gastos-tesoreria.repository';
import { DestinosRepository } from './destinos.repository';
import { MovimientosRepository } from './movimientos.repository';
import { METODOS_COBRANZA, destinoDe } from './reglas-destino';
import { TesoreriaRepository } from './tesoreria.repository';

const MENSAJE_DUPLICADA = 'Ya existe una cuenta con ese nombre.';
const MENSAJE_GENERAL =
  'Las cuentas generales solo las administra un usuario General.';

/** `23505` unique_violation y `23503` foreign_key_violation (ver vehiculos.service.ts). */
function codigoPg(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export interface FilaSaldoDelDia {
  cuentaId: string;
  nombre: string;
  sucursalCodigo: string | null;
  saldo: {
    id: string;
    montoCentavos: number;
    comentario: string | null;
  } | null;
}

export interface SaldosDelDia {
  fecha: string;
  cuentas: FilaSaldoDelDia[];
  saldos: SaldoFijado[];
}

interface UsuarioSucursal {
  id: string | null;
  codigo: string | null;
}

@Injectable()
export class TesoreriaService {
  constructor(
    private readonly repo: TesoreriaRepository,
    private readonly destinos: DestinosRepository,
    private readonly movimientos: MovimientosRepository,
    private readonly cobranza: CobranzaTesoreriaRepository,
    // T-30/T-31: los gastos de la ruta se leen de `gasto`, como la cobranza.
    private readonly gastos: GastosTesoreriaRepository,
  ) {}

  /**
   * La vista: saldo al inicio y al final por cuenta, entradas y salidas del rango,
   * total, cobranza sin cuenta y eventos (spec §4.2). La cobranza se lee de TODAS
   * las sucursales (y los gastos de la ruta, T-30/T-31): una cuenta general puede
   * recibir la de varias. `sinCuenta` y `gastosSinCuenta` solo reportan las sucursales en alcance.
   */
  async vista(
    usuarioId: string,
    q: VistaTesoreriaDto,
  ): Promise<VistaTesoreria> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const alcance = await this.alcanceDe(
      usuarioId,
      normalizarSucursalPedida(q.sucursal),
    );
    const codigo = alcance.tipo === 'todas' ? null : alcance.codigo;
    const cuentas = await this.repo.listarCuentas(codigo);
    const ids = cuentas.map((c) => c.id);
    const [saldos, manuales, cobranza, destinos, gastos] = await Promise.all([
      this.repo.saldosDeCuentas(ids, q.hasta),
      this.movimientos.listar(ids, null, q.hasta),
      this.cobranza.porDia(q.hasta),
      this.destinos.listar(null),
      this.gastos.porDia(q.hasta),
    ]);
    return armarVista(q.desde, q.hasta, cuentas, saldos, {
      manuales,
      cobranza,
      destinos,
      gastos,
      sucursalesEnAlcance: codigo === null ? null : [codigo],
    });
  }

  async listarCuentas(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<CuentaEnAlcance[]> {
    const alcance = await this.alcanceDe(usuarioId, sucursalPedida);
    return this.repo.listarCuentas(
      alcance.tipo === 'todas' ? null : alcance.codigo,
    );
  }

  async crearCuenta(
    usuarioId: string,
    dto: CrearCuentaDto,
  ): Promise<CuentaEnAlcance> {
    const usuario = await this.usuario(usuarioId);
    // Atado: la suya, se ignora lo que mande. General: lo que mande, o general.
    const sucursalId = usuario.id ?? dto.sucursalId ?? null;
    let cuenta: CuentaEnAlcance | undefined;
    try {
      cuenta = await this.repo.crearCuenta(dto.nombre, sucursalId);
    } catch (error) {
      if (codigoPg(error) === '23505')
        throw new ConflictException(MENSAJE_DUPLICADA);
      if (codigoPg(error) === '23503')
        throw new BadRequestException('La sucursal no existe.');
      throw error;
    }
    if (!cuenta) throw new NotFoundException('No existe esa cuenta.');
    return cuenta;
  }

  async renombrarCuenta(
    usuarioId: string,
    id: string,
    dto: RenombrarCuentaDto,
  ): Promise<CuentaEnAlcance> {
    await this.cuentaModificable(usuarioId, id);
    let cuenta: CuentaEnAlcance | undefined;
    try {
      cuenta = await this.repo.renombrarCuenta(id, dto.nombre);
    } catch (error) {
      if (codigoPg(error) === '23505')
        throw new ConflictException(MENSAJE_DUPLICADA);
      throw error;
    }
    if (!cuenta) throw new NotFoundException('No existe esa cuenta.');
    return cuenta;
  }

  async eliminarCuenta(usuarioId: string, id: string): Promise<void> {
    await this.cuentaModificable(usuarioId, id);
    // No se elimina la cuenta que HOY recibe la cobranza de alguna sucursal:
    // el dinero quedaria sin cuenta (spec §3.3). Si solo fue destino en el
    // pasado, si se puede.
    const destinos = await this.destinos.listar(null);
    const hoy = await this.repo.hoyEnTijuana();
    const sucursales = [...new Set(destinos.map((d) => d.sucursalId))];
    for (const sucursalId of sucursales) {
      for (const metodo of METODOS_COBRANZA) {
        const vigente = destinoDe(sucursalId, metodo, hoy, destinos);
        if (vigente?.cuentaId === id) {
          throw new ConflictException(
            `Esta cuenta recibe la cobranza de ${vigente.sucursalCodigo} (${metodo}). Cambia ese destino antes de eliminarla.`,
          );
        }
      }
    }
    await this.repo.eliminarCuenta(id);
  }

  /**
   * La pestaña Saldos: solo las cuentas que el usuario puede MODIFICAR (un usuario
   * atado no ve aqui las generales), con su saldo fijado en `fecha`, y la lista
   * de todos sus saldos fijados vivos (mas recientes primero).
   */
  async saldosDelDia(
    usuarioId: string,
    sucursalPedida: string | null,
    fecha: string,
  ): Promise<SaldosDelDia> {
    if (!esFechaValida(fecha))
      throw new BadRequestException('La fecha no es válida.');
    const usuario = await this.usuario(usuarioId);
    const alcance = resolverAlcance(usuario.codigo, sucursalPedida);
    const visibles = await this.repo.listarCuentas(
      alcance.tipo === 'todas' ? null : alcance.codigo,
    );
    const cuentas =
      usuario.id === null
        ? visibles
        : visibles.filter((c) => c.sucursalId !== null);
    const saldos = await this.repo.saldosDeCuentas(
      cuentas.map((c) => c.id),
      null,
    );

    return {
      fecha,
      cuentas: cuentas.map((c) => {
        const delDia = saldos.find(
          (s) => s.cuentaId === c.id && s.fecha === fecha,
        );
        return {
          cuentaId: c.id,
          nombre: c.nombre,
          sucursalCodigo: c.sucursalCodigo,
          saldo: delDia
            ? {
                id: delDia.id,
                montoCentavos: delDia.montoCentavos,
                comentario: delDia.comentario,
              }
            : null,
        };
      }),
      saldos,
    };
  }

  async guardarSaldos(
    usuarioId: string,
    dto: GuardarSaldosDto,
  ): Promise<{ guardados: number }> {
    if (!esFechaValida(dto.fecha))
      throw new BadRequestException('La fecha no es válida.');
    const ids = dto.saldos.map((s) => s.cuentaId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Una cuenta viene dos veces en el lote.');
    }
    if (dto.fecha > (await this.repo.hoyEnTijuana())) {
      throw new BadRequestException(
        'No se puede fijar un saldo en una fecha futura.',
      );
    }
    // Antes de escribir nada: cualquier cuenta ajena (404) o general para un
    // usuario atado (403) tumba el lote completo.
    for (const id of ids) await this.cuentaModificable(usuarioId, id);

    const ok = await this.repo.guardarSaldos(
      dto.fecha,
      dto.saldos.map((s) => ({
        cuentaId: s.cuentaId,
        montoCentavos: s.montoCentavos,
        comentario: s.comentario ?? null,
      })),
      usuarioId,
    );
    if (!ok) throw new NotFoundException('Una de las cuentas ya no existe.');
    return { guardados: dto.saldos.length };
  }

  async eliminarSaldo(usuarioId: string, id: string): Promise<void> {
    const saldo = await this.repo.buscarSaldo(id);
    if (!saldo) throw new NotFoundException('No existe ese saldo.');
    await this.cuentaModificable(usuarioId, saldo.cuentaId);
    await this.repo.eliminarSaldo(id);
  }

  /**
   * La cuenta viva que el usuario VE (T-29, movimientos): la de su sucursal o una
   * general; un General, cualquiera. Otra sucursal o borrada -> 404. A diferencia
   * de `cuentaModificable`, una general SI pasa para un usuario atado.
   */
  async cuentaVisible(
    usuarioId: string,
    cuentaId: string,
  ): Promise<CuentaEnAlcance> {
    const usuario = await this.usuario(usuarioId);
    const cuenta = await this.repo.buscarCuenta(cuentaId);
    if (!cuenta) throw new NotFoundException('No existe esa cuenta.');
    if (
      usuario.id !== null &&
      cuenta.sucursalId !== null &&
      cuenta.sucursalId !== usuario.id
    ) {
      throw new NotFoundException('No existe esa cuenta.');
    }
    return cuenta;
  }

  /**
   * La cuenta viva que el usuario puede MODIFICAR (spec §3.2):
   *   - no existe / dada de baja / de otra sucursal -> 404 (no se revela)
   *   - general y el usuario esta atado a una sucursal -> 403
   */
  async cuentaModificable(
    usuarioId: string,
    cuentaId: string,
  ): Promise<CuentaEnAlcance> {
    const usuario = await this.usuario(usuarioId);
    const cuenta = await this.repo.buscarCuenta(cuentaId);
    if (!cuenta) throw new NotFoundException('No existe esa cuenta.');
    if (usuario.id !== null) {
      if (cuenta.sucursalId === null)
        throw new ForbiddenException(MENSAJE_GENERAL);
      if (cuenta.sucursalId !== usuario.id)
        throw new NotFoundException('No existe esa cuenta.');
    }
    return cuenta;
  }

  async usuario(usuarioId: string): Promise<UsuarioSucursal> {
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    const fila = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!fila) throw new UnauthorizedException('Sesion invalida.');
    return fila;
  }

  protected async alcanceDe(
    usuarioId: string,
    sucursalPedida: string | null,
  ): Promise<Alcance> {
    const usuario = await this.usuario(usuarioId);
    return resolverAlcance(usuario.codigo, sucursalPedida);
  }
}
