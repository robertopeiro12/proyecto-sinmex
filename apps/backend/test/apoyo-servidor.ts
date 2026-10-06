import type { INestApplication } from '@nestjs/common';

/**
 * Arranca la app de prueba escuchando SOLO en `127.0.0.1`, en un puerto libre.
 *
 * Reemplaza a `app.init()`. Con `init()` el servidor no escucha, y supertest lo
 * abre por su cuenta con `listen(0)` **sin host**, o sea en todas las
 * direcciones (`::`). Despues le habla a `127.0.0.1:<puerto>`.
 *
 * > [!bug] Por que no basta `init()` (encontrado el 2026-10-06)
 * > En macOS, con `SO_REUSEADDR` (que Node activa), un `listen` en `::` se
 * > concede aunque OTRO proceso ya tenga ese mismo puerto en `127.0.0.1`. En
 * > las maquinas del equipo eso pasa: `limactl` (Colima) y VS Code escuchan en
 * > puertos altos de `127.0.0.1`. Si el sorteo de `listen(0)` cae en uno de
 * > esos, la peticion de supertest la contesta el otro proceso y la prueba
 * > truena con `Parse Error: Expected HTTP/, RTSP/ or ICE/` o `socket hang
 * > up`, en una suite cualquiera y cada vez distinta. Pasaba ~1 de cada 10
 * > corridas en `main`, mas con el backend y el portal de desarrollo
 * > corriendo. En CI no se ve porque ahi no hay Colima ni VS Code.
 *
 * Escuchando en `127.0.0.1` el sistema nunca asigna un puerto ocupado en esa
 * misma direccion, asi que el choque no puede ocurrir. supertest reutiliza el
 * servidor ya abierto en vez de abrir otro.
 */
export async function iniciarEnLocal(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}
