import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthVendedorController } from './auth-vendedor.controller';
import { AuthVendedorService } from './auth-vendedor.service';
import { PasswordService } from './password.service';
import { PerfilesController } from './perfiles.controller';
import { PerfilesRepository } from './perfiles.repository';
import { PerfilesService } from './perfiles.service';
import { PermisosRepository } from './permisos.repository';
import { SesionRepository } from './sesion.repository';
import { SesionVendedorRepository } from './sesion-vendedor.repository';
import { TokenService } from './token.service';
import { TokenVendedorService } from './token-vendedor.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          // Preferimos no arrancar a arrancar inseguro.
          //
          // Se mantiene aunque configuracion.schema.ts ya exija JWT_SECRET:
          // ese schema vive en el ConfigModule de AppModule, y AuthModule se
          // puede montar sin el — las pruebas lo hacen, y cualquier futura
          // app (la de tablet, un worker) tambien podria. Este chequeo es lo
          // unico que protege ese camino. Es defensa en profundidad barata:
          // tres lineas contra un backend firmando tokens con `undefined`.
          throw new Error('Falta JWT_SECRET.');
        }
        return { secret };
      },
    }),
  ],
  controllers: [AuthController, AuthVendedorController, PerfilesController],
  providers: [
    AuthService,
    AuthVendedorService,
    PasswordService,
    TokenService,
    TokenVendedorService,
    SesionRepository,
    SesionVendedorRepository,
    PermisosRepository,
    PerfilesRepository,
    PerfilesService,
  ],
  // TokenVendedorService y PermisosRepository se exportan porque los inyectan
  // los guards que app.module.ts registra como APP_GUARD, y por tanto se
  // resuelven fuera de este modulo. Sin exportarlos, la app no arranca.
  exports: [
    AuthService,
    TokenService,
    AuthVendedorService,
    TokenVendedorService,
    PermisosRepository,
  ],
})
export class AuthModule {}
