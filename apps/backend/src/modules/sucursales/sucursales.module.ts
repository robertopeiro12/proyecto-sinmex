import { Module } from '@nestjs/common';
import { SucursalesController } from './sucursales.controller';
import { SucursalesRepository } from './sucursales.repository';
import { SucursalesService } from './sucursales.service';

@Module({
  controllers: [SucursalesController],
  providers: [SucursalesService, SucursalesRepository],
})
export class SucursalesModule {}
