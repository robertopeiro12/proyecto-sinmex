import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import { exigirFechaReal } from './fechas';
import { NotasAsignadasRepository } from './notas-asignadas.repository';
import { NotasRutaRepository } from './notas-ruta.repository';
import {
  armarNotasDeRuta,
  type NotaDeRuta,
  type NotasDeRuta,
} from './reglas-notas-ruta';
import { esFechaEditable } from './reglas-ruta-semanal';
import { RELOJ_RUTAS, type RelojRutas } from './reloj';
import {
  MOTIVO_FECHA_PASADA,
  RutasDiariasService,
} from './rutas-diarias.service';

export const MOTIVO_NOTA_INEXISTENTE = 'No existe esa nota.';
export const MOTIVO_NOTA_SIN_SALDO = 'Esa nota ya no tiene saldo.';

/** 400 de una nota cuyo cliente no esta en la ruta de ese dia. */
export function motivoClienteFueraDeRuta(cliente: string): string {
  return `Primero agrega a ${cliente} a la ruta.`;
}

/**
 * Notas por cobrar asignadas a un vendedor para un dia (spec §5.4): ver,
 * asignar, pasar y quitar. Candados, en este orden: la fila del `vendedor`
 * destino y la `venta_nota`. Al pasar NO se bloquea al vendedor anterior: su
 * fila `nota_asignada` se da de baja bajo el candado de la nota.
 */
@Injectable()
export class NotasAsignadasService {
  constructor(
    private readonly repo: NotasAsignadasRepository,
    private readonly notas: NotasRutaRepository,
    private readonly rutas: RutasDiariasService,
    @Inject(RELOJ_RUTAS) private readonly reloj: RelojRutas,
  ) {}

  /** `GET`: las pendientes de su ruta y las asignadas a el. */
  async ver(
    usuarioId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<NotasDeRuta> {
    exigirFechaReal(fecha);
    const vendedor = await this.rutas.vendedorEnAlcance(usuarioId, vendedorId);
    return this.armar(vendedor.id, fecha, this.hoy());
  }

  /** `PUT`: asigna la nota, o la pasa si la traia otro ese dia. */
  async asignar(
    usuarioId: string,
    ventaNotaId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<NotasDeRuta> {
    exigirFechaReal(fecha);
    const hoy = this.exigirEditable(fecha);
    const vendedor = await this.rutas.vendedorEnAlcance(usuarioId, vendedorId);
    ventaNotaId = ventaNotaId.toLowerCase();

    await this.repo.enTransaccion(async (trx) => {
      await this.repo.bloquearVendedor(vendedor.id, trx);
      const nota = await this.repo.bloquearNota(ventaNotaId, trx);
      // Una nota de otra sucursal no se confirma: 404.
      if (
        !nota ||
        !nota.viva ||
        nota.clienteSucursalId !== vendedor.sucursalId
      ) {
        throw new NotFoundException(MOTIVO_NOTA_INEXISTENTE);
      }

      const actual = await this.repo.asignacionViva(nota.id, fecha, trx);
      if (actual?.vendedorId === vendedor.id) return; // ya la trae: nada que escribir

      const clientes = await this.repo.clientesDeLaRuta(
        vendedor.id,
        fecha,
        trx,
      );
      if (!clientes.includes(nota.clienteId)) {
        throw new BadRequestException(
          motivoClienteFueraDeRuta(nota.clienteNombre),
        );
      }
      const conSaldo = await this.notas.notasConSaldo(
        [nota.clienteId],
        hoy,
        trx,
      );
      if (!conSaldo.some((n) => n.ventaNotaId === nota.id)) {
        throw new ConflictException(MOTIVO_NOTA_SIN_SALDO);
      }

      if (actual) await this.repo.darDeBaja(actual.id, usuarioId, trx);
      await this.repo.asignar(
        { ventaNotaId: nota.id, vendedorId: vendedor.id, fecha, usuarioId },
        trx,
      );
    });

    return this.armar(vendedor.id, fecha, hoy);
  }

  /** `DELETE`: quita la nota de este vendedor ese dia. Si no la traia, no hace nada. */
  async quitar(
    usuarioId: string,
    ventaNotaId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<NotasDeRuta> {
    exigirFechaReal(fecha);
    const hoy = this.exigirEditable(fecha);
    const vendedor = await this.rutas.vendedorEnAlcance(usuarioId, vendedorId);
    ventaNotaId = ventaNotaId.toLowerCase();

    await this.repo.enTransaccion(async (trx) => {
      await this.repo.bloquearVendedor(vendedor.id, trx);
      // Aunque la venta se haya borrado, su asignacion se puede quitar.
      const nota = await this.repo.bloquearNota(ventaNotaId, trx);
      if (!nota || nota.clienteSucursalId !== vendedor.sucursalId) {
        throw new NotFoundException(MOTIVO_NOTA_INEXISTENTE);
      }
      const actual = await this.repo.asignacionViva(nota.id, fecha, trx);
      if (actual?.vendedorId === vendedor.id) {
        await this.repo.darDeBaja(actual.id, usuarioId, trx);
      }
    });

    return this.armar(vendedor.id, fecha, hoy);
  }

  private hoy(): string {
    return hoyEnTijuana(this.reloj());
  }

  /** Exige fecha de hoy o posterior y devuelve el `hoy` leido, para no leer el reloj dos veces. */
  private exigirEditable(fecha: string): string {
    const hoy = this.hoy();
    if (!esFechaEditable(fecha, hoy)) {
      throw new BadRequestException(MOTIVO_FECHA_PASADA);
    }
    return hoy;
  }

  private async armar(
    vendedorId: string,
    fecha: string,
    hoy: string,
  ): Promise<NotasDeRuta> {
    const clientes = await this.repo.clientesDeLaRuta(vendedorId, fecha);
    const conSaldo = await this.notas.notasConSaldo(clientes, hoy);
    const idsAsignadas = await this.repo.idsAsignadasA(vendedorId, fecha);
    const yaLeidas = new Set(conSaldo.map((n) => n.ventaNotaId));
    const extra = await this.notas.notasPorId(
      idsAsignadas.filter((id) => !yaLeidas.has(id)),
      hoy,
    );
    const todas = [...conSaldo, ...extra];
    const quien = await this.repo.asignacionesDe(
      todas.map((n) => n.ventaNotaId),
      fecha,
    );
    const lista: NotaDeRuta[] = todas.map((n) => ({
      ...n,
      asignadaA: quien.get(n.ventaNotaId) ?? null,
    }));
    return armarNotasDeRuta(clientes, lista, vendedorId);
  }
}
