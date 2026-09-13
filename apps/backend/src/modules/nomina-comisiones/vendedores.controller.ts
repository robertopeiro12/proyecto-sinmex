import { Controller, Get, Query } from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { VendedoresService } from './vendedores.service';
import type { Vendedor } from './vendedores.repository';

// Sin @Publico(): el guard global protege todo por defecto. Listar NO exige
// vendedor.gestionar a proposito: Rutas (T-36/T-37) y Nomina (T-47) van a
// necesitar este catalogo, no solo quien administra vendedores. Crear y
// editar SI lo exigen (Tasks 4 y 5).
@Controller('vendedores')
export class VendedoresController {
  constructor(private readonly vendedores: VendedoresService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<Vendedor[]> {
    return this.vendedores.listar(
      usuarioId,
      normalizarSucursalPedida(sucursal),
    );
  }
}
