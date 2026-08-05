import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OPCIONES_NEST, configurarApp } from './configurar-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, OPCIONES_NEST);
  const config = app.get(ConfigService);

  configurarApp(app);
  app.enableCors({
    origin: config.get<string>('PORTAL_URL', 'http://localhost:3001'),
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
