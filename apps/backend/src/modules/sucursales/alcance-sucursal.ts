import { ForbiddenException } from '@nestjs/common';

/**
 * Valor reservado del query param para "todas las sucursales". No puede
 * chocar con ningun codigo real: los codigos son 2 letras MAYUSCULAS
 * (restriccion sucursal_codigo_formato) y este valor va en minusculas.
 */
export const TODAS = 'todas';

export type Alcance = { tipo: 'todas' } | { tipo: 'una'; codigo: string };

/**
 * Decide que sucursales puede ver el usuario. El query param es solo una
 * preferencia de UI: quien manda es la sucursal asignada al usuario, y por eso
 * esta funcion se llama SIEMPRE en el servidor, nunca se confia en el cliente.
 *
 * Es una funcion pura a proposito. La misma regla la van a necesitar los cinco
 * catalogos que siguen (T-10, T-11, T-12, T-13, T-62), y aislada de la base se
 * puede probar entera sin montar Postgres.
 *
 * @param codigoDelUsuario codigo de su sucursal, o null si es General
 * @param codigoPedido lo que pidio en la URL, ya normalizado
 */
export function resolverAlcance(
  codigoDelUsuario: string | null,
  codigoPedido: string | null,
): Alcance {
  // General: manda lo que pida.
  if (codigoDelUsuario === null) {
    if (codigoPedido === null || codigoPedido === TODAS) {
      return { tipo: 'todas' };
    }
    return { tipo: 'una', codigo: codigoPedido };
  }

  // Atado a una sucursal: siempre la suya. "todas" y "nada" NO son error —
  // ninguno nombra una sucursal ajena, y ambos son lo que produce navegar con
  // un selector que quedo puesto. Solo pedir OTRA sucursal por su nombre es
  // un intento de salirse del alcance.
  if (
    codigoPedido === null ||
    codigoPedido === TODAS ||
    codigoPedido === codigoDelUsuario
  ) {
    return { tipo: 'una', codigo: codigoDelUsuario };
  }

  throw new ForbiddenException('No tienes acceso a esa sucursal.');
}

/**
 * Normaliza el valor crudo del query param antes de pasarlo a resolverAlcance.
 *
 * Es permisiva con las mayusculas porque un codigo mal capitalizado en un link
 * escrito a mano no es un error que le importe a nadie, y el valor reservado
 * "todas" se compara aparte, asi que subir a mayusculas no lo puede pisar.
 */
export function normalizarSucursalPedida(
  crudo: string | undefined,
): string | null {
  const limpio = crudo?.trim();
  if (!limpio) {
    return null;
  }
  if (limpio.toLowerCase() === TODAS) {
    return TODAS;
  }
  return limpio.toUpperCase();
}
