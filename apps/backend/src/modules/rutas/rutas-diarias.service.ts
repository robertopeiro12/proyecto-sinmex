import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import { hoyEnTijuana } from '../sincronizacion/operaciones';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type { RutaAltaNormalizada } from './datos-ruta-alta';
import type { GuardarRutaDiariaDto } from './dto/ruta-diaria.dto';
import { NotasRutaRepository } from './notas-ruta.repository';
import { planearReemplazo } from './reemplazo-ruta';
import { diaSemanaDe, esFechaEditable, nombreDia } from './reglas-ruta-semanal';
import { RELOJ_RUTAS, type RelojRutas } from './reloj';
import { RutaRechazada } from './ruta-rechazada';
import {
  RutasDiariasRepository,
  type FilaRutaDiaria,
  type OrigenRuta,
  type RutaDiaGuardada,
  type VendedorDeRuta,
} from './rutas-diarias.repository';
import {
  RutasSemanalesRepository,
  type FilaRutaSemanal,
} from './rutas-semanales.repository';

export type { FilaRutaDiaria, OrigenRuta };

/**
 * Quien y cuando de un alta de ruta. Todo sale del token o del sobre:
 *
 * - `sucursalId` y `vendedorId`: los del vendedor del token.
 * - `fechaOperacion`: la del sobre, tal cual la calculo la tablet. El servidor
 *   no la re-deriva de UTC; un alta capturada ayer sin red y subida hoy cae en
 *   la ruta de AYER.
 */
export interface ContextoRutaAlta {
  sucursalId: string;
  vendedorId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadRuta {
  tabla: 'ruta';
  id: string;
}

export const MOTIVO_FECHA_INEXISTENTE = 'Esa fecha no existe.';
export const MOTIVO_VENDEDOR_INEXISTENTE = 'No existe ese vendedor.';
export const MOTIVO_CLIENTE_REPETIDO = 'Un cliente viene dos veces en la ruta.';
export const MOTIVO_FECHA_PASADA = 'Ese día ya pasó; solo se puede consultar.';
export const MOTIVO_VEHICULO_AJENO = 'Ese vehículo no es de la sucursal.';
export const MOTIVO_RUTA_CAMBIO =
  'La ruta de ese día cambió mientras guardabas. Vuelve a abrirla e intenta otra vez.';
const MOTIVO_ELIGE_SUCURSAL = 'Elige una sucursal.';

/** 400 de una ruta semanal que no es del dia de la semana de la fecha (o de otra sucursal, o no existe). */
export function motivoRutaDeOtroDia(fecha: string): string {
  const dia = diaSemanaDe(fecha);
  return `Esa ruta no es del ${dia === null ? 'domingo' : nombreDia(dia)}.`;
}

/** 409 de una ruta semanal que ya trae otro vendedor ese dia. */
export function motivoRutaOcupada(vendedor: string): string {
  return `Esa ruta ya la trae ${vendedor} ese día.`;
}

/**
 * El 400 de un `PUT` con clientes nuevos que no valen, nombrandolos: sin el
 * nombre la oficina no sabe cual quitar. `nombres` trae el nombre del cliente
 * si es de la sucursal del vendedor (aunque este borrado o sea prospecto) o, si
 * es de otra sucursal o ni existe, su id: el nombre de un cliente ajeno no se
 * revela.
 */
export function motivoClientesNoValidos(nombres: readonly string[]): string {
  return `Estos clientes no existen, están dados de baja, son prospectos o no son de la sucursal del vendedor: ${nombres.join(', ')}.`;
}

/** `GET`/`PUT /rutas/diaria`: la ruta de un vendedor y dia (spec §5.2). */
export interface RutaDiaria {
  vendedor: { id: string; nombre: string; sucursalCodigo: string };
  fecha: string;
  /** `false` = un dia que ya paso (de Tijuana): solo lectura. */
  editable: boolean;
  /** `null` = "Sin ruta". El nombre es el congelado al asignarla. */
  rutaSemanal: { id: string; nombre: string } | null;
  vehiculo: { id: string; nombre: string } | null;
  filas: FilaRutaDiaria[];
}

/** Un renglon de la lista del dia (spec §5.1): un vendedor activo. */
export interface RenglonDia {
  vendedorId: string;
  vendedor: string;
  sucursalCodigo: string;
  /** `null` = "Sin ruta". */
  rutaNombre: string | null;
  clientes: number;
  /** Notas con saldo de los clientes de su ruta (la definicion de `NotasRutaRepository`). */
  notasPendientes: number;
  /** Notas asignadas a el ese dia (vivas), tengan saldo o no. */
  notasAsignadas: number;
  vehiculo: string | null;
  /** Hay encabezado (`ruta_dia`) vivo o filas vivas ese dia. */
  tieneRuta: boolean;
}

/** `GET /rutas/diaria/dia`. */
export interface ListaDelDia {
  fecha: string;
  editable: boolean;
  renglones: RenglonDia[];
}

/** `GET /rutas/diaria/opciones`: lo que llena las listas de la pantalla del vendedor. */
export interface OpcionesDia {
  /** Las rutas semanales del dia de la semana de la fecha; `ocupadaPor` = otro vendedor que la trae. */
  rutas: { id: string; nombre: string; ocupadaPor: string | null }[];
  vehiculos: { id: string; nombre: string; ocupadoPor: string | null }[];
}

/**
 * `AAAA-MM-DD` que existe en el calendario. El DTO ya comprobo el formato;
 * esto evita que un 30 de febrero llegue a Postgres y salga como 500.
 */
function exigirFechaReal(fecha: string): void {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    f.getUTCFullYear() !== anio ||
    f.getUTCMonth() !== mes - 1 ||
    f.getUTCDate() !== dia
  ) {
    throw new BadRequestException(MOTIVO_FECHA_INEXISTENTE);
  }
}

/** Recado recortado; vacio = `null`. El DTO ya recorto y limito a 200. */
function recadoLimpio(recado: string | null | undefined): string | null {
  const limpio = recado?.trim() ?? '';
  return limpio === '' ? null : limpio;
}

/**
 * La ruta diaria en el servidor: la proyeccion de `ruta-alta` (T-37) y la
 * pantalla Ruta Diaria del portal (spec §5). Vive en `rutas/` porque es el
 * slug del vault para [[Rutas]].
 *
 * Candados del portal, siempre en este orden (el mismo que la propagacion de
 * la Ruta Semanal): las `ruta_semanal` involucradas, por id, y despues la fila
 * del `vendedor`.
 */
@Injectable()
export class RutasDiariasService {
  constructor(
    private readonly repo: RutasDiariasRepository,
    private readonly semanales: RutasSemanalesRepository,
    private readonly notas: NotasRutaRepository,
    @Inject(RELOJ_RUTAS) private readonly reloj: RelojRutas,
  ) {}

  /** "Hoy" de Tijuana, nunca el de UTC. */
  private hoy(): string {
    return hoyEnTijuana(this.reloj());
  }

  /**
   * Agrega al final de la ruta de ese dia un cliente que el vendedor sumo a
   * mano, dentro de la transaccion de quien llama (ADR-0009).
   *
   * @throws {RutaRechazada} `cliente-inexistente` o `ruta-duplicada`. No
   * escribe nada antes de lanzar.
   */
  async agregarAlDia(
    alta: RutaAltaNormalizada,
    contexto: ContextoRutaAlta,
    trx: Transaction<DB>,
  ): Promise<EntidadRuta> {
    const valido = await this.repo.clienteParaRuta(
      alta.clienteId,
      contexto.sucursalId,
      trx,
    );
    if (!valido) {
      throw new RutaRechazada({
        razon: 'cliente-inexistente',
        // Sin el id: la tablet pinta el motivo bajo la fila, que ya lleva el
        // nombre del cliente.
        motivo:
          'El cliente no existe, está dado de baja, es un prospecto o no es de tu sucursal.',
      });
    }

    // Antes de leer el orden: ver `bloquearVendedor`.
    await this.repo.bloquearVendedor(contexto.vendedorId, trx);
    const orden = await this.repo.siguienteOrden(
      contexto.vendedorId,
      contexto.fechaOperacion,
      trx,
    );

    const id = await this.repo.insertarSiNoExiste(
      {
        vendedorId: contexto.vendedorId,
        clienteId: alta.clienteId,
        fecha: contexto.fechaOperacion,
        orden,
        origen: 'vendedor',
      },
      trx,
    );
    if (id === null) {
      // La oficina (u otra tablet) ya lo tenia. La tablet lo trata como
      // aplicado (D15): no es un error del vendedor.
      throw new RutaRechazada({
        razon: 'ruta-duplicada',
        motivo: `El cliente ya está en tu ruta del ${contexto.fechaOperacion}.`,
      });
    }

    return { tabla: 'ruta', id };
  }

  /** `GET /rutas/diaria/dia`: un renglon por vendedor activo de la sucursal, por nombre. */
  async listaDelDia(
    usuarioId: string,
    fecha: string,
    sucursal: string | undefined,
  ): Promise<ListaDelDia> {
    exigirFechaReal(fecha);
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(sucursal),
    );
    if (alcance.tipo === 'todas') {
      throw new BadRequestException(MOTIVO_ELIGE_SUCURSAL);
    }

    const vendedores = await this.repo.vendedoresActivos(alcance.codigo);
    const resumen = await this.repo.resumenDelDia(
      vendedores.map((v) => v.id),
      fecha,
    );
    const todosLosClientes = new Set(
      [...resumen.values()].flatMap((r) => r.clientes),
    );
    const notasPorCliente = new Map<string, number>();
    for (const nota of await this.notas.notasConSaldo(
      [...todosLosClientes],
      this.hoy(),
    )) {
      notasPorCliente.set(
        nota.clienteId,
        (notasPorCliente.get(nota.clienteId) ?? 0) + 1,
      );
    }

    return {
      fecha,
      editable: esFechaEditable(fecha, this.hoy()),
      renglones: vendedores.map((v) => {
        const r = resumen.get(v.id)!;
        return {
          vendedorId: v.id,
          vendedor: v.nombre,
          sucursalCodigo: v.sucursalCodigo,
          rutaNombre: r.rutaDia?.nombreRuta ?? null,
          clientes: r.clientes.length,
          notasPendientes: r.clientes.reduce(
            (suma, c) => suma + (notasPorCliente.get(c) ?? 0),
            0,
          ),
          notasAsignadas: r.notasAsignadas,
          vehiculo: r.rutaDia?.vehiculoNombre ?? null,
          tieneRuta: r.rutaDia !== undefined || r.clientes.length > 0,
        };
      }),
    };
  }

  /** `GET /rutas/diaria`. */
  async obtenerDiaria(
    usuarioId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<RutaDiaria> {
    exigirFechaReal(fecha);
    const vendedor = await this.vendedorEnAlcance(usuarioId, vendedorId);
    return this.rutaDe(vendedor, fecha);
  }

  /** `GET /rutas/diaria/opciones`: no escribe nada. */
  async opciones(
    usuarioId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<OpcionesDia> {
    exigirFechaReal(fecha);
    const vendedor = await this.vendedorEnAlcance(usuarioId, vendedorId);
    const dia = diaSemanaDe(fecha);
    return {
      // El domingo no tiene rutas semanales.
      rutas:
        dia === null
          ? []
          : await this.repo.rutasParaElDia(
              vendedor.sucursalId,
              dia,
              fecha,
              vendedor.id,
            ),
      vehiculos: await this.repo.vehiculosParaElDia(
        vendedor.sucursalId,
        fecha,
        vendedor.id,
      ),
    };
  }

  /**
   * `PUT /rutas/diaria`: reemplaza la ruta de ese vendedor y dia (ruta
   * semanal, vehiculo, clientes en orden y recados) en UNA transaccion. La
   * regla de las filas esta en `planearReemplazo`.
   *
   * Solo se validan los clientes NUEVOS (sin fila viva ese dia): revalidar una
   * fila del vendedor cuyo cliente se borro bloquearia todo guardado de ese
   * dia. Un cliente nuevo que no vale y viene de la ruta semanal elegida se
   * SALTA (la oficina no lo puso a mano); uno agregado a mano es 400.
   */
  async reemplazarDiaria(
    usuarioId: string,
    dto: GuardarRutaDiariaDto,
  ): Promise<RutaDiaria> {
    exigirFechaReal(dto.fecha);
    this.exigirEditable(dto.fecha);
    const pedidos = dto.clientes.map((c) => ({
      clienteId: c.clienteId.toLowerCase(),
      recado: recadoLimpio(c.recado),
    }));
    if (new Set(pedidos.map((p) => p.clienteId)).size !== pedidos.length) {
      throw new BadRequestException(MOTIVO_CLIENTE_REPETIDO);
    }
    const rutaSemanalId = dto.rutaSemanalId?.toLowerCase() ?? null;
    const vehiculoId = dto.vehiculoId?.toLowerCase() ?? null;
    const vendedor = await this.vendedorEnAlcance(usuarioId, dto.vendedorId);

    await this.repo.enTransaccion(async (trx) => {
      const { guardada, semanalesBloqueadas } = await this.bloquear(
        vendedor.id,
        dto.fecha,
        [rutaSemanalId],
        trx,
      );

      let semanal: FilaRutaSemanal | undefined;
      let clientesDeLaSemanal = new Set<string>();
      let listaDeLaSemanal = new Set<string>();
      if (rutaSemanalId !== null) {
        semanal = semanalesBloqueadas.get(rutaSemanalId);
        if (
          !semanal ||
          semanal.sucursalId !== vendedor.sucursalId ||
          semanal.diaSemana !== diaSemanaDe(dto.fecha)
        ) {
          throw new BadRequestException(motivoRutaDeOtroDia(dto.fecha));
        }
        const otro = await this.repo.quienTraeLaRuta(
          semanal.id,
          dto.fecha,
          vendedor.id,
          trx,
        );
        if (otro !== undefined) {
          throw new ConflictException(motivoRutaOcupada(otro));
        }
        const lista = await this.semanales.lista(semanal, trx);
        listaDeLaSemanal = new Set(lista.map((c) => c.clienteId));
        clientesDeLaSemanal = new Set(
          lista.filter((c) => c.valido).map((c) => c.clienteId),
        );
      }

      // Solo se valida un vehiculo NUEVO: reenviar el que ya tenia asignado,
      // aunque se haya desactivado despues, no bloquea el guardado.
      if (
        vehiculoId !== null &&
        vehiculoId !== (guardada?.vehiculoId ?? null) &&
        !(await this.repo.vehiculoParaRuta(
          vehiculoId,
          vendedor.sucursalId,
          trx,
        ))
      ) {
        throw new BadRequestException(MOTIVO_VEHICULO_AJENO);
      }

      const vivas = await this.repo.filasVivas(vendedor.id, dto.fecha, trx);
      const yaVivos = new Set(vivas.map((v) => v.clienteId));
      const nuevos = pedidos
        .map((p) => p.clienteId)
        .filter((c) => !yaVivos.has(c));
      const validos = await this.repo.clientesParaRuta(
        nuevos,
        vendedor.sucursalId,
        trx,
      );
      const invalidos = nuevos.filter((c) => !validos.has(c));
      const aMano = invalidos.filter((c) => !listaDeLaSemanal.has(c));
      if (aMano.length > 0) {
        const nombres = await this.repo.nombresDeClientes(
          aMano,
          vendedor.sucursalId,
          trx,
        );
        throw new BadRequestException(
          motivoClientesNoValidos(aMano.map((c) => nombres.get(c) ?? c)),
        );
      }
      const saltados = new Set(invalidos);
      const quedan = pedidos.filter((p) => !saltados.has(p.clienteId));

      if (
        rutaSemanalId === null &&
        vehiculoId === null &&
        quedan.length === 0
      ) {
        // Nada que guardar en el encabezado: no se deja uno vacio (la lista
        // del dia diria "tiene ruta"), y el que habia se da de baja.
        if (guardada) {
          await this.repo.darDeBajaRutaDia(guardada.id, usuarioId, trx);
        }
      } else {
        await this.repo.guardarRutaDia(
          {
            vendedorId: vendedor.id,
            fecha: dto.fecha,
            rutaSemanalId,
            nombreRuta: semanal?.nombre ?? null,
            vehiculoId,
            usuarioId,
          },
          guardada,
          trx,
        );
      }
      const plan = planearReemplazo(vivas, quedan, {
        clientesDeLaSemanal,
        rutaCambio: (guardada?.rutaSemanalId ?? null) !== rutaSemanalId,
      });
      await this.repo.aplicarReemplazo(vendedor.id, dto.fecha, plan, trx);
      await this.repo.quitarNotasAsignadas(
        vendedor.id,
        dto.fecha,
        plan.borrar.map((f) => f.clienteId),
        usuarioId,
        trx,
      );
    });

    return this.rutaDe(vendedor, dto.fecha);
  }

  /**
   * `DELETE /rutas/diaria` ("Quitar ruta"): baja del encabezado, de lo que
   * puso la oficina o la semanal y de las notas asignadas ese dia. Lo que
   * agrego el vendedor se queda.
   */
  async quitarDiaria(
    usuarioId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<void> {
    exigirFechaReal(fecha);
    this.exigirEditable(fecha);
    const vendedor = await this.vendedorEnAlcance(usuarioId, vendedorId);
    await this.repo.enTransaccion(async (trx) => {
      await this.bloquear(vendedor.id, fecha, [], trx);
      await this.repo.quitarRutaDia(vendedor.id, fecha, usuarioId, trx);
    });
  }

  private exigirEditable(fecha: string): void {
    if (!esFechaEditable(fecha, this.hoy())) {
      throw new BadRequestException(MOTIVO_FECHA_PASADA);
    }
  }

  /**
   * Toma los candados del portal en el orden de la casa: las `ruta_semanal`
   * involucradas (la que el encabezado tiene guardada y las `otras`), por id,
   * y despues el vendedor. La propagacion de la Ruta Semanal toma la semanal y
   * luego el vendedor sin revalidar, asi que nadie puede cambiar la ruta del
   * dia de una semanal sin tener su candado.
   *
   * El encabezado se lee antes (para saber que semanal bloquear) y otra vez
   * con el vendedor bloqueado: si otro guardado lo cambio en medio, 409 (el
   * candado de la semanal nueva ya no se puede tomar sin romper el orden).
   */
  private async bloquear(
    vendedorId: string,
    fecha: string,
    otras: readonly (string | null)[],
    trx: Transaction<DB>,
  ): Promise<{
    guardada: RutaDiaGuardada | undefined;
    semanalesBloqueadas: Map<string, FilaRutaSemanal>;
  }> {
    const antes = await this.repo.rutaDia(vendedorId, fecha, trx);
    const ids = [
      ...new Set(
        [antes?.rutaSemanalId ?? null, ...otras].filter(
          (id): id is string => id !== null,
        ),
      ),
    ].sort();
    const semanalesBloqueadas = new Map<string, FilaRutaSemanal>();
    for (const id of ids) {
      const ruta = await this.semanales.buscar(id, trx);
      if (ruta) semanalesBloqueadas.set(id, ruta);
    }

    await this.repo.bloquearVendedor(vendedorId, trx);
    const guardada = await this.repo.rutaDia(vendedorId, fecha, trx);
    if (
      (guardada?.id ?? null) !== (antes?.id ?? null) ||
      (guardada?.rutaSemanalId ?? null) !== (antes?.rutaSemanalId ?? null)
    ) {
      throw new ConflictException(MOTIVO_RUTA_CAMBIO);
    }
    return { guardada, semanalesBloqueadas };
  }

  private async rutaDe(
    vendedor: VendedorDeRuta,
    fecha: string,
  ): Promise<RutaDiaria> {
    const rutaDia = await this.repo.rutaDia(vendedor.id, fecha);
    return {
      vendedor: {
        id: vendedor.id,
        nombre: vendedor.nombre,
        sucursalCodigo: vendedor.sucursalCodigo,
      },
      fecha,
      editable: esFechaEditable(fecha, this.hoy()),
      rutaSemanal:
        rutaDia?.rutaSemanalId && rutaDia.nombreRuta !== null
          ? { id: rutaDia.rutaSemanalId, nombre: rutaDia.nombreRuta }
          : null,
      vehiculo:
        rutaDia?.vehiculoId && rutaDia.vehiculoNombre !== null
          ? { id: rutaDia.vehiculoId, nombre: rutaDia.vehiculoNombre }
          : null,
      filas: await this.repo.filasDelDia(vendedor.id, fecha),
    };
  }

  /**
   * El vendedor, si el usuario lo alcanza. **404 y no 403** (D14): a un
   * usuario de otra sucursal no se le confirma que el vendedor exista. Por eso
   * no se usa `exigirAlcanceSobre`, que responde 403.
   */
  private async vendedorEnAlcance(
    usuarioId: string,
    vendedorId: string,
  ): Promise<VendedorDeRuta> {
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    // El guard valido la FIRMA del token, no que el usuario siga existiendo.
    if (!usuario) throw new UnauthorizedException('Sesión inválida.');

    const vendedor = await this.repo.vendedorDeRuta(vendedorId.toLowerCase());
    const alcance = resolverAlcance(usuario.codigo, null);
    if (
      !vendedor ||
      (alcance.tipo === 'una' && alcance.codigo !== vendedor.sucursalCodigo)
    ) {
      throw new NotFoundException(MOTIVO_VENDEDOR_INEXISTENTE);
    }
    return vendedor;
  }
}
