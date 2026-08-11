import { SetMetadata } from '@nestjs/common';

export const PERMISO_REQUERIDO = 'permiso_requerido';

/**
 * Exige un permiso concreto en un endpoint del portal:
 *
 *     @Post()
 *     @RequierePermiso('sucursal.gestionar')
 *     async crear(...)
 *
 * Un endpoint SIN este decorador sigue exigiendo solo sesion valida, como
 * hasta T-08a. Es a proposito: el guard no puede adivinar que permiso le
 * tocaria a cada endpoint, y negar por defecto dejaria la API entera muerta
 * mientras los perfiles esten vacios (lo estan hasta T-08b).
 *
 * La `clave` debe existir en la tabla `permiso`. No hay comprobacion en
 * tiempo de compilacion: una clave mal escrita se comporta como un permiso que
 * nadie tiene, o sea un 403 permanente. Cada ticket que agregue un permiso
 * agrega tambien su prueba e2e, que es donde se caza ese error.
 */
export const RequierePermiso = (clave: string) =>
  SetMetadata(PERMISO_REQUERIDO, clave);
