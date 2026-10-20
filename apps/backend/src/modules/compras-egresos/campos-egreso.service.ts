import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import {
  CamposEgresoRepository,
  type CambiosCampoEgreso,
  type CampoEgreso,
} from './campos-egreso.repository';
import type {
  CrearCampoEgresoDto,
  EditarCampoEgresoDto,
} from './dto/campo-egreso.dto';
import { inicioDelAnioEnTijuana } from './reglas-campo-egreso';

const NO_EXISTE = 'No existe ese campo de egreso.';
const CON_GASTOS_ESTE_ANIO =
  'Este campo tiene gastos este año; podrás darlo de baja el próximo año.';

function duplicado(nombre: string): ConflictException {
  return new ConflictException(
    `Ya existe un campo de egreso llamado "${nombre}".`,
  );
}

/**
 * El catalogo de campos de egreso del portal (T-30, D2/D3). El duplicado lo
 * decide el indice unico de la base, no una consulta previa (criterio de
 * T-09/T-12). Editar siempre se puede: los gastos ya registrados guardan una
 * copia del nombre y del tipo (D4).
 */
@Injectable()
export class CamposEgresoService {
  constructor(private readonly repo: CamposEgresoRepository) {}

  listar(): Promise<CampoEgreso[]> {
    return this.repo.listarVivos();
  }

  async crear(dto: CrearCampoEgresoDto): Promise<CampoEgreso> {
    try {
      return await this.repo.crear(
        dto.nombre,
        dto.tipo,
        dto.seUsaEnApp ?? false,
      );
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre);
      throw error;
    }
  }

  async editar(id: string, dto: EditarCampoEgresoDto): Promise<CampoEgreso> {
    const cambios: CambiosCampoEgreso = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.tipo !== undefined) cambios.tipo = dto.tipo;
    if (dto.seUsaEnApp !== undefined) cambios.se_usa_en_app = dto.seUsaEnApp;
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay nada que actualizar.');
    }

    let campo: CampoEgreso | undefined;
    try {
      campo = await this.repo.editar(id, cambios);
    } catch (error) {
      if (esViolacionUnicidad(error)) throw duplicado(dto.nombre ?? '');
      throw error;
    }
    if (!campo) throw new NotFoundException(NO_EXISTE);
    return campo;
  }

  /**
   * Baja logica, salvo que el campo tenga gastos vivos del año en curso en
   * Tijuana (D2, regla del cliente: "no se puede eliminar hasta el siguiente
   * año"). Un gasto que entre entre la consulta y la baja no se pierde: el push
   * acepta un campo dado de baja (D5).
   */
  async darDeBaja(id: string, ahora: Date = new Date()): Promise<void> {
    if (await this.repo.tieneGastosDesde(id, inicioDelAnioEnTijuana(ahora))) {
      throw new ConflictException(CON_GASTOS_ESTE_ANIO);
    }
    if (!(await this.repo.darDeBaja(id)))
      throw new NotFoundException(NO_EXISTE);
  }
}
