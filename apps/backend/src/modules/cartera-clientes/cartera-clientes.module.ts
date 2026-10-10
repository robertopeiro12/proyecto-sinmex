import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesRepository } from './clientes.repository';
import { ClientesService } from './clientes.service';
import { FotosRepository } from './fotos.repository';
import { FotosService } from './fotos.service';
import { ListasPrecioController } from './listas-precio.controller';
import { PreciosController } from './precios.controller';
import { PreciosRepository } from './precios.repository';
import { PreciosService } from './precios.service';
import { TiposNegocioController } from './tipos-negocio.controller';
import { TiposNegocioRepository } from './tipos-negocio.repository';
import { TiposNegocioService } from './tipos-negocio.service';

// Cartera de Clientes es el modulo de dominio del vault que agrupa Cliente y
// Lista de precios (Lista de precios.md declara `modulo: cartera-clientes`).
// Precios lo lleno T-18; Tipos de Negocio y Cliente (con sus respectivos
// controller/service/repository) llegan con T-12.
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
    // T-40 (foto del prospecto): el archivo vive en el disco del backend y las
    // dos columnas en `cliente`, del que esta modulo es el dueno (ADR-0009).
    FotosService,
    FotosRepository,
    PreciosService,
    PreciosRepository,
    TiposNegocioService,
    TiposNegocioRepository,
  ],
  // T-16: ventas-cobranza consulta los precios vigentes de un cliente para
  // validar una venta. Cartera de Clientes es la duena de los precios, asi que
  // la consulta vive aqui y se exporta en vez de duplicarse.
  //
  // T-40: `sincronizacion/` despacha el `tipo: 'prospecto'` del push a
  // `ClientesService.crearProspecto` (ADR-0009 §2.1). La dependencia va de
  // sincronizacion hacia aqui, nunca al reves: Cartera de Clientes es la duena
  // de `cliente` y la regla vive una sola vez.
  //
  // T-40 (foto): `sincronizacion/` expone `POST /sync/foto/:clave` —la clave de
  // la URL es la del buzon del push— y despacha aqui a guardar el archivo. La
  // dependencia sigue yendo de sincronizacion hacia Cartera de Clientes.
  exports: [PreciosRepository, ClientesService, FotosService],
})
export class CarteraClientesModule {}
