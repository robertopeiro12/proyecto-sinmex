import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesRepository } from './clientes.repository';
import { ClientesService } from './clientes.service';
import { ListasPrecioController } from './listas-precio.controller';
import { PreciosController } from './precios.controller';
import { PreciosRepository } from './precios.repository';
import { PreciosService } from './precios.service';
import { TiposNegocioController } from './tipos-negocio.controller';
import { TiposNegocioRepository } from './tipos-negocio.repository';
import { TiposNegocioService } from './tipos-negocio.service';

// Cartera de Clientes es el modulo de dominio del vault que agrupa Cliente y
// Lista de precios (Lista de precios.md declara `modulo: cartera-clientes`).
// Precios lo lleno T-18; Tipos de Negocio y Cliente llegan con T-12 (esta
// tarea agrega Tipos de Negocio; Clientes se registra en la Task 5).
@Module({
  controllers: [
    ClientesController,
    ListasPrecioController,
    PreciosController,
    TiposNegocioController,
  ],
  providers: [
    ClientesService,
    ClientesRepository,
    PreciosService,
    PreciosRepository,
    TiposNegocioService,
    TiposNegocioRepository,
  ],
})
export class CarteraClientesModule {}
