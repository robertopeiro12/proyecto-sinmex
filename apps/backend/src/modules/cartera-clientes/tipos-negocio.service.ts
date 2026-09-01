import { ConflictException, Injectable } from '@nestjs/common';
import { esViolacionUnicidad } from '../../database/errores-postgres';
import {
  TiposNegocioRepository,
  type TipoNegocio,
} from './tipos-negocio.repository';

@Injectable()
export class TiposNegocioService {
  constructor(private readonly repo: TiposNegocioRepository) {}

  async listar(): Promise<TipoNegocio[]> {
    return this.repo.listar();
  }

  async crear(nombre: string): Promise<TipoNegocio> {
    try {
      return await this.repo.crear(nombre);
    } catch (error) {
      if (esViolacionUnicidad(error)) {
        throw new ConflictException(
          `Ya existe un tipo de negocio llamado "${nombre}".`,
        );
      }
      throw error;
    }
  }
}
