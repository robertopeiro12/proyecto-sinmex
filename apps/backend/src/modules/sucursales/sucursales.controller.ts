import { Controller, Get, Query } from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from './alcance-sucursal';
import { SucursalesService } from './sucursales.service';
import type { Sucursal } from './sucursales.repository';

// Sin @Publico(): el guard global de app.module.ts protege todo por defecto.
// El permiso fino (`sucursal.gestionar`) llega con T-08.
@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly sucursales: SucursalesService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<Sucursal[]> {
    return this.sucursales.listar(
      usuarioId,
      normalizarSucursalPedida(sucursal),
    );
  }
}
