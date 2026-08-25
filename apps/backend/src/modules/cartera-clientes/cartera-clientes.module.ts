import { Module } from '@nestjs/common';
import { ListasPrecioController } from './listas-precio.controller';
import { PreciosController } from './precios.controller';
import { PreciosRepository } from './precios.repository';
import { PreciosService } from './precios.service';

// Cartera de Clientes es el modulo de dominio del vault que agrupa Cliente y
// Lista de precios (Lista de precios.md declara `modulo: cartera-clientes`).
// Precios es lo primero que lo llena; Cliente llega con T-12.
@Module({
  controllers: [ListasPrecioController, PreciosController],
  providers: [PreciosService, PreciosRepository],
})
export class CarteraClientesModule {}
