import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { FotosService } from '../cartera-clientes/fotos.service';
import { validarRango } from '../estadisticas/reglas-kilometraje';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import type { ListarGastosDto } from './dto/listar-gastos.dto';
import type { GastoNormalizado } from './datos-gasto';
import { GastoRechazado } from './gasto-rechazado';
import { GastosRepository, type GastoListado } from './gastos.repository';
import { METODO_GASTO_RUTA } from './tipos-egreso';

/** La respuesta de `GET /gastos` (D10). */
export interface ListaGastos {
  desde: string;
  hasta: string;
  gastos: GastoListado[];
  totalCentavos: number;
}

const SIN_FOTO = 'Ese gasto no tiene foto.';

/** `undefined`/vacio = sin filtro; un uuid en minusculas; otra cosa, 400. */
function filtroId(crudo: string | undefined, mensaje: string): string | null {
  const valor = crudo?.trim();
  if (!valor) return null;
  if (!isUUID(valor)) throw new BadRequestException(mensaje);
  return valor.toLowerCase();
}

/**
 * Quien, cual y cuando. Todo sale del token o del sobre, nunca de `datos`:
 * `id` es la clave de la operacion (uuid validado en `prepararGasto`),
 * `sucursalId`/`vendedorId` los del token y `fechaOperacion` la del sobre, sin
 * re-derivarla de UTC.
 */
export interface ContextoGasto {
  id: string;
  sucursalId: string;
  vendedorId: string;
  fechaOperacion: string;
}

/** La fila a la que apunta el buzon (`sync_operacion.entidad_*`). */
export interface EntidadGasto {
  tabla: 'gasto';
  id: string;
}

/**
 * Los gastos en el servidor (T-30/T-31). Proyecta el `tipo: 'gasto'` que sube
 * la tablet; vive en `compras-egresos/` (ADR-0009). El siguiente ticket le suma
 * las compras de oficina del portal sobre la misma tabla.
 *
 * **No revisa `se_usa_en_app`** (D5): la oficina puede cambiar la casilla
 * mientras la tablet esta sin red, y rechazar un gasto ya pagado por eso seria
 * perder el dinero de vista.
 */
@Injectable()
export class GastosService {
  constructor(
    private readonly repo: GastosRepository,
    // T-30/T-31 (D10): la foto del ticket vive en el disco de fotos de Cartera.
    private readonly fotos: FotosService,
  ) {}

  /**
   * @throws {GastoRechazado} `campo-egreso-inexistente` o `gasto-id-ocupado`.
   * No escribe nada antes de lanzar.
   */
  async registrarGasto(
    gasto: GastoNormalizado,
    contexto: ContextoGasto,
    trx: Transaction<DB>,
  ): Promise<EntidadGasto> {
    const campo = await this.repo.campoParaGasto(gasto.campoEgresoId, trx);
    if (!campo) {
      throw new GastoRechazado({
        razon: 'campo-egreso-inexistente',
        motivo: `El campo de egreso ${gasto.campoEgresoId} no existe en el catálogo.`,
      });
    }
    const quien = await this.repo.nombreVendedor(contexto.vendedorId, trx);

    const id = await this.repo.insertar(
      {
        id: contexto.id,
        sucursalId: contexto.sucursalId,
        vendedorId: contexto.vendedorId,
        campoEgresoId: gasto.campoEgresoId,
        // Copia (D4): editar el campo despues no cambia lo ya registrado.
        campoNombre: campo.nombre,
        tipo: campo.tipo,
        fecha: contexto.fechaOperacion,
        registradoEn: gasto.registradoEn,
        montoCentavos: gasto.montoCentavos,
        metodo: METODO_GASTO_RUTA,
        origen: 'app',
        quien,
        comentario: gasto.comentario,
      },
      trx,
    );
    if (id === null) {
      // Neutro a proposito, como `visita-id-ocupado` (T-39).
      throw new GastoRechazado({
        razon: 'gasto-id-ocupado',
        motivo: 'El id de este gasto ya está ocupado. Avisa a la oficina.',
      });
    }
    return { tabla: 'gasto', id };
  }

  /** T-30 (D8): para el canal de fotos. */
  existe(id: string): Promise<boolean> {
    return this.repo.existe(id);
  }

  /** T-30 (D8): el archivo ya esta en disco; esto anota la columna. */
  anotarFoto(id: string, archivo: string, subidaEn: Date): Promise<boolean> {
    return this.repo.anotarFoto(id, archivo, subidaEn);
  }

  /**
   * `GET /gastos` (D10): los gastos vivos del rango, con el alcance de sucursal
   * del usuario. Valida antes de consultar: un rango malo no llega a la base.
   */
  async listar(usuarioId: string, q: ListarGastosDto): Promise<ListaGastos> {
    const error = validarRango(q.desde, q.hasta);
    if (error) throw new BadRequestException(error);
    const vendedorId = filtroId(q.vendedor, 'El vendedor no es válido.');
    const campoEgresoId = filtroId(q.campo, 'El campo no es válido.');
    const codigoSucursal = await this.codigoEnAlcance(usuarioId, q.sucursal);

    const gastos = await this.repo.listar({
      desde: q.desde,
      hasta: q.hasta,
      codigoSucursal,
      vendedorId,
      campoEgresoId,
    });
    const totalCentavos = gastos.reduce((s, g) => s + g.montoCentavos, 0);
    return { desde: q.desde, hasta: q.hasta, gastos, totalCentavos };
  }

  /**
   * `GET /gastos/:id/foto` (D10): la ruta del ticket si el gasto es de una
   * sucursal en alcance. Otra sucursal es 404, no 403: no confirma que exista.
   */
  async rutaFoto(usuarioId: string, id: string): Promise<string> {
    const codigoSucursal = await this.codigoEnAlcance(usuarioId, undefined);
    const archivo = await this.repo.fotoEnAlcance(id, codigoSucursal);
    if (archivo === null) throw new NotFoundException(SIN_FOTO);
    return this.fotos.rutaDeArchivo(archivo, SIN_FOTO);
  }

  /** `null` = todas; si no, el codigo de la unica sucursal visible. */
  private async codigoEnAlcance(
    usuarioId: string,
    sucursalPedida: string | undefined,
  ): Promise<string | null> {
    // El guard valido la firma del token, no que el usuario siga existiendo.
    const usuario = await this.repo.buscarSucursalUsuario(usuarioId);
    if (!usuario) throw new UnauthorizedException('Sesion invalida.');
    const alcance = resolverAlcance(
      usuario.codigo,
      normalizarSucursalPedida(sucursalPedida),
    );
    return alcance.tipo === 'una' ? alcance.codigo : null;
  }
}
