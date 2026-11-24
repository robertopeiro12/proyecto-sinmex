import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import type {
  CrearMotivoMermaDto,
  EditarMotivoMermaDto,
} from './dto/motivo-merma.dto';
import {
  MotivosMermaRepository,
  type CambiosMotivoMerma,
  type MotivoMerma,
} from './motivos-merma.repository';

const NO_EXISTE = 'No existe ese motivo de merma.';
const SIN_CASILLAS = 'El motivo tiene que aplicar al menos a un lugar.';

function duplicado(nombre: string): ConflictException {
  return new ConflictException(
    `Ya existe un motivo de merma llamado "${nombre}".`,
  );
}

/**
 * El catalogo de motivos de merma del portal (Registro de Operacion, D7). El
 * duplicado lo decide el indice unico de la base. "Al menos una casilla" se
 * revisa aqui, contra lo que ya estaba guardado en las que no se mandan.
 */
@Injectable()
export class MotivosMermaService {
  constructor(private readonly repo: MotivosMermaRepository) {}

  listar(aplica?: string): Promise<MotivoMerma[]> {
    if (aplica !== undefined && aplica !== 'almacen') {
      throw new BadRequestException(
        'El filtro "aplica" solo admite "almacen".',
      );
    }
    return this.repo.listarVivos(aplica === 'almacen');
  }

  async crear(dto: CrearMotivoMermaDto): Promise<MotivoMerma> {
    const almacen = dto.aplicaAlmacen ?? true;
    const cliente = dto.aplicaCliente ?? true;
    const vehiculo = dto.aplicaVehiculo ?? true;
    if (!almacen && !cliente && !vehiculo) {
      throw new BadRequestException(SIN_CASILLAS);
    }
    try {
      return await this.repo.crear(dto.nombre, almacen, cliente, vehiculo);
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre);
      throw error;
    }
  }

  async editar(id: string, dto: EditarMotivoMermaDto): Promise<MotivoMerma> {
    const cambios: CambiosMotivoMerma = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.aplicaAlmacen !== undefined)
      cambios.aplica_almacen = dto.aplicaAlmacen;
    if (dto.aplicaCliente !== undefined)
      cambios.aplica_cliente = dto.aplicaCliente;
    if (dto.aplicaVehiculo !== undefined)
      cambios.aplica_vehiculo = dto.aplicaVehiculo;
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    const tocaCasillas =
      cambios.aplica_almacen !== undefined ||
      cambios.aplica_cliente !== undefined ||
      cambios.aplica_vehiculo !== undefined;
    if (tocaCasillas) {
      const actual = await this.repo.obtenerVivo(id);
      if (!actual) throw new NotFoundException(NO_EXISTE);
      const queda =
        (cambios.aplica_almacen ?? actual.aplicaAlmacen) ||
        (cambios.aplica_cliente ?? actual.aplicaCliente) ||
        (cambios.aplica_vehiculo ?? actual.aplicaVehiculo);
      if (!queda) throw new BadRequestException(SIN_CASILLAS);
    }

    let motivo: MotivoMerma | undefined;
    try {
      motivo = await this.repo.editar(id, cambios);
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre ?? '');
      throw error;
    }
    if (!motivo) throw new NotFoundException(NO_EXISTE);
    return motivo;
  }

  /** Baja logica: las mermas ya registradas lo siguen referenciando. */
  async darDeBaja(id: string): Promise<void> {
    if (!(await this.repo.darDeBaja(id)))
      throw new NotFoundException(NO_EXISTE);
  }
}
