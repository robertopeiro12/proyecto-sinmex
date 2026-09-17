import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';

/**
 * Opciones de creacion de la app Nest. **Deben pasarse tanto en main.ts como
 * en las pruebas e2e**, porque bodyParser NO es middleware: es una opcion de
 * NestFactory.create()/createNestApplication() y no se puede aplicar despues.
 *
 * `bodyParser: false` apaga los parsers que Nest registra por su cuenta, entre
 * ellos express.urlencoded. Eso no es una optimizacion, es la defensa contra
 * CSRF de login:
 *
 * Con el parser de formularios activo, una pagina de un atacante puede
 * autoenviar un <form action="https://api.../auth/login" method="POST"> con
 * sus propias credenciales. Es una peticion "simple": no lleva preflight, asi
 * que CORS no la detiene (CORS bloquea LEER la respuesta, no enviarla), y el
 * atacante no necesita leerla — le basta con que el navegador de la victima se
 * quede con el Set-Cookie. sameSite=lax tampoco ayuda: impide que las cookies
 * VIAJEN cross-site, no que se RECIBAN. La victima acaba trabajando dentro de
 * la cuenta del atacante y escribiendo ahi datos reales.
 *
 * Al aceptar solo application/json, el navegador se ve obligado a mandar
 * preflight (Content-Type: application/json no esta en la lista de tipos
 * simples), y el preflight es exactamente lo que CORS si rechaza.
 *
 * Por eso: no volver a activar urlencoded por comodidad. Si algun dia hace
 * falta aceptar formularios, primero hay que implementar un token CSRF.
 */
export const OPCIONES_NEST = { bodyParser: false } as const;

/**
 * Middleware y pipes globales. Vive aqui y no dentro de bootstrap() porque las
 * pruebas e2e construyen la app con createNestApplication(), que no pasa por
 * main.ts: si cada una lo replicara a mano, una prueba podria seguir en verde
 * sobre una configuracion que produccion ya no tiene.
 */
export function configurarApp(app: INestApplication): void {
  app.use(cookieParser());
  // Unico parser de body: JSON. Ver OPCIONES_NEST para el porque.
  //
  // El limite es explicito porque el default de body-parser son 100 kB y un
  // lote de push cabe de sobra por encima: 500 ventas pesan 218-754 kB. Sin
  // este limite el cuerpo se rechazaba con 413 antes de llegar a Nest, y la
  // tablet leia cualquier no-ok como "sin red" y reenviaba el mismo lote para
  // siempre. 5 MB son cinco veces MAX_BYTES_POR_LOTE (1 MB), el tope con el que
  // la tablet cierra cada lote: la holgura absorbe el sobre del envio y una
  // operacion suelta mas grande que el tope. **Un 413 en produccion es un bug
  // de troceo de la tablet, no un limite de negocio.**
  app.use(express.json({ limit: '5mb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
