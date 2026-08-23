import { Controller, Get, Query } from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { normalizarSucursalPedida } from '../sucursales/alcance-sucursal';
import { VehiculosService } from './vehiculos.service';
import type { Vehiculo } from './vehiculos.repository';

// Sin @Publico(): el guard global de app.module.ts protege todo por defecto.
// Listar NO exige `vehiculo.gestionar` a proposito: el catalogo lo van a
// necesitar Rutas (T-38) y los reportes de kilometraje, no solo quien lo
// administra. El alcance de lo que cada quien VE ya lo acota
// alcance-sucursal.ts. Crear y editar SI lo exigen (Tasks 3 y 4).
@Controller('vehiculos')
export class VehiculosController {
  constructor(private readonly vehiculos: VehiculosService) {}

  @Get()
  async listar(
    @UsuarioActual() usuarioId: string,
    @Query('sucursal') sucursal?: string,
  ): Promise<Vehiculo[]> {
    return this.vehiculos.listar(usuarioId, normalizarSucursalPedida(sucursal));
  }
}
