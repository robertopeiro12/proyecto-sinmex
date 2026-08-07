import { Module } from '@nestjs/common';
import { SincronizacionController } from './sincronizacion.controller';
import { SincronizacionRepository } from './sincronizacion.repository';
import { SincronizacionService } from './sincronizacion.service';

@Module({
  controllers: [SincronizacionController],
  providers: [SincronizacionService, SincronizacionRepository],
})
export class SincronizacionModule {}
