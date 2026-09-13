import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { VendedoresController } from './vendedores.controller';
import { VendedoresRepository } from './vendedores.repository';
import { VendedoresService } from './vendedores.service';

// Vendedor vive aqui y no en un `modules/vendedores/` nuevo: el CLAUDE.md
// fija que los modulos usan los slugs del vault, y `Vendedor.md` declara
// `modulo: nomina-comisiones` (D1 del spec).
//
// `PasswordService` se registra aqui (no se importa `AuthModule`) porque
// AuthModule NO la exporta -- solo exporta AuthService, TokenService,
// AuthVendedorService, TokenVendedorService y PermisosRepository (ver
// auth.module.ts). Es una clase sin estado (envuelve argon2), asi que
// registrarla en un segundo modulo es seguro y no duplica nada con efectos.
@Module({
  controllers: [VendedoresController],
  providers: [VendedoresService, VendedoresRepository, PasswordService],
})
export class NominaComisionesModule {}
