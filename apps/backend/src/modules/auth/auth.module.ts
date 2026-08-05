import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SesionRepository } from './sesion.repository';
import { TokenService } from './token.service';

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
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, SesionRepository],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
