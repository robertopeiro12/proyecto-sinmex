import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { resolverAlcance } from '../sucursales/alcance-sucursal';
import type { GuardarRutaDiariaDto } from './dto/ruta-diaria.dto';
import { planearReemplazo } from './reemplazo-ruta';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { RutaAltaNormalizada } from './datos-ruta-alta';
import { RutaRechazada } from './ruta-rechazada';
import {
  RutasDiariasRepository,
  type FilaRutaDiaria,
  type VendedorDeRuta,
} from './rutas-diarias.repository';

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

/**
 * El 400 de un `PUT` con clientes nuevos que no valen, nombrandolos: sin el
 * nombre la oficina no sabe cual quitar. `nombres` trae el nombre del cliente
 * (aunque este borrado) o, si ni existe, su id.
 */
export function motivoClientesNoValidos(nombres: readonly string[]): string {
  return `Estos clientes no existen, están dados de baja, son prospectos o no son de la sucursal del vendedor: ${nombres.join(', ')}.`;
}

/** `GET`/`PUT /rutas/diaria` (D14). */
export interface RutaDiaria {
  vendedor: { id: string; nombre: string; sucursalCodigo: string };
  fecha: string;
  filas: FilaRutaDiaria[];
}

/** `GET /rutas/diaria/anterior`: lo que carga "Copiar de ayer" (D17). */
export interface RutaAnterior {
  fecha: string | null;
  clientes: string[];
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

/**
 * La ruta diaria en el servidor (T-37): la proyeccion de `ruta-alta` (aqui) y
 * la pantalla Ruta Diaria del portal (Tarea 5). Vive en `rutas/` porque es el
 * slug del vault para [[Rutas]].
 */
@Injectable()
export class RutasDiariasService {
  constructor(private readonly repo: RutasDiariasRepository) {}

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

  /**
   * `PUT /rutas/diaria`: reemplaza la ruta de ese vendedor y dia con la lista,
   * en UNA transaccion (un error no deja la ruta a medias). La regla esta en
   * `planearReemplazo`.
   *
   * Solo se validan los clientes NUEVOS (sin fila viva ese dia). Adoptar o
   * reordenar una viva no revalida: el portal no deja quitar las filas del
   * vendedor, asi que si el cliente de una de ellas se borro, cambio de
   * sucursal o volvio a prospecto, revalidarla bloquearia todo guardado de ese
   * dia.
   */
  async reemplazarDiaria(
    usuarioId: string,
    dto: GuardarRutaDiariaDto,
  ): Promise<RutaDiaria> {
    exigirFechaReal(dto.fecha);
    const clientes = dto.clientes.map((c) => c.toLowerCase());
    if (new Set(clientes).size !== clientes.length) {
      throw new BadRequestException(MOTIVO_CLIENTE_REPETIDO);
    }
    const vendedor = await this.vendedorEnAlcance(usuarioId, dto.vendedorId);

    await this.repo.enTransaccion(async (trx) => {
      // El mismo candado que el alta de la tablet (`agregarAlDia`): las vivas
      // se leen DESPUES, asi que un alta que llego un instante antes se adopta
      // en vez de chocar con la unicidad.
      await this.repo.bloquearVendedor(vendedor.id, trx);
      const vivas = await this.repo.filasVivas(vendedor.id, dto.fecha, trx);
      const yaVivos = new Set(vivas.map((v) => v.clienteId));
      const nuevos = clientes.filter((c) => !yaVivos.has(c));
      const validos = await this.repo.clientesParaRuta(
        nuevos,
        vendedor.sucursalId,
        trx,
      );
      const invalidos = nuevos.filter((c) => !validos.has(c));
      if (invalidos.length > 0) {
        const nombres = await this.repo.nombresDeClientes(invalidos, trx);
        throw new BadRequestException(
          motivoClientesNoValidos(invalidos.map((c) => nombres.get(c) ?? c)),
        );
      }
      await this.repo.aplicarReemplazo(
        vendedor.id,
        dto.fecha,
        planearReemplazo(vivas, clientes),
        trx,
      );
    });

    return this.rutaDe(vendedor, dto.fecha);
  }

  /** `GET /rutas/diaria/anterior`: no escribe nada. */
  async anterior(
    usuarioId: string,
    vendedorId: string,
    fecha: string,
  ): Promise<RutaAnterior> {
    exigirFechaReal(fecha);
    const vendedor = await this.vendedorEnAlcance(usuarioId, vendedorId);
    const previa = await this.repo.fechaAnteriorConRuta(vendedor.id, fecha);
    if (previa === null) return { fecha: null, clientes: [] };
    return {
      fecha: previa,
      clientes: await this.repo.clientesValidosDeFecha(
        vendedor.id,
        previa,
        vendedor.sucursalId,
      ),
    };
  }

  private async rutaDe(
    vendedor: VendedorDeRuta,
    fecha: string,
  ): Promise<RutaDiaria> {
    return {
      vendedor: {
        id: vendedor.id,
        nombre: vendedor.nombre,
        sucursalCodigo: vendedor.sucursalCodigo,
      },
      fecha,
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
