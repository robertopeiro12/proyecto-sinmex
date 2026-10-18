import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import type {
  CrearMotivoVisitaDto,
  EditarMotivoVisitaDto,
} from './dto/motivo-visita.dto';
import {
  MotivosVisitaRepository,
  type CambiosMotivoVisita,
  type MotivoVisita,
} from './motivos-visita.repository';

const NO_EXISTE = 'No existe ese motivo de visita.';

function duplicado(nombre: string): ConflictException {
  return new ConflictException(
    `Ya existe un motivo de visita llamado "${nombre}".`,
  );
}

/**
 * El catalogo de motivos de visita del portal (T-39, D5). El duplicado lo
 * decide el indice unico de la base, no una consulta previa (mismo criterio que
 * T-09/T-12): entre el SELECT y el INSERT cabe otra peticion.
 */
@Injectable()
export class MotivosVisitaService {
  constructor(private readonly repo: MotivosVisitaRepository) {}

  listar(): Promise<MotivoVisita[]> {
    return this.repo.listarVivos();
  }

  async crear(dto: CrearMotivoVisitaDto): Promise<MotivoVisita> {
    try {
      return await this.repo.crear(
        dto.nombre,
        dto.exigeFoto ?? false,
        dto.exigeAtendio ?? false,
      );
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre);
      throw error;
    }
  }

  async editar(id: string, dto: EditarMotivoVisitaDto): Promise<MotivoVisita> {
    const cambios: CambiosMotivoVisita = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.exigeFoto !== undefined) cambios.exige_foto = dto.exigeFoto;
    if (dto.exigeAtendio !== undefined)
      cambios.exige_atendio = dto.exigeAtendio;
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    let motivo: MotivoVisita | undefined;
    try {
      motivo = await this.repo.editar(id, cambios);
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre ?? '');
      throw error;
    }
    if (!motivo) throw new NotFoundException(NO_EXISTE);
    return motivo;
  }

  /**
   * Baja logica. Las visitas ya registradas lo siguen referenciando y una
   * tablet sin red todavia puede subir una con el (D3: el push lo acepta).
   */
  async darDeBaja(id: string): Promise<void> {
    if (!(await this.repo.darDeBaja(id)))
      throw new NotFoundException(NO_EXISTE);
  }
}
