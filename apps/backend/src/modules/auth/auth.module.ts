import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthVendedorController } from './auth-vendedor.controller';
import { AuthVendedorService } from './auth-vendedor.service';
import { PasswordService } from './password.service';
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
  controllers: [AuthController, AuthVendedorController],
  providers: [
    AuthService,
    AuthVendedorService,
    PasswordService,
    TokenService,
    TokenVendedorService,
    SesionRepository,
    SesionVendedorRepository,
  ],
  // TokenVendedorService se exporta porque lo inyecta JwtAuthGuard, que se
  // registra como APP_GUARD en AppModule y por tanto se resuelve fuera de este
  // modulo. Sin exportarlo, la app no arranca.
  exports: [
    AuthService,
    TokenService,
    AuthVendedorService,
    TokenVendedorService,
  ],
})
export class AuthModule {}
