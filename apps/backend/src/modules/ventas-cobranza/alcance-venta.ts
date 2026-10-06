import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { resolverAlcance } from '../sucursales/alcance-sucursal';

/**
 * Exige que el usuario alcance la sucursal de algo YA LEIDO de la base (el
 * cliente de una venta nueva, una venta existente). Misma doctrina que
 * `ClientesService.obtener`: se compara contra el hecho, nunca contra un query
 * param.
 *
 * Extraida de `VentasPortalService` (T-17 parte 1) porque la busqueda, el
 * detalle y la edicion de la parte 2 necesitan exactamente la misma regla.
 *
 * @param usuario lo que devuelve `buscarSucursalUsuario`; `undefined` = el
 * usuario no existe o esta dado de baja.
 */
export function exigirAlcanceSobre(
  usuario: { codigo: string | null } | undefined,
  codigoSucursal: string,
): void {
  if (!usuario) throw new UnauthorizedException('Sesion invalida.');
  const alcance = resolverAlcance(usuario.codigo, null);
  if (alcance.tipo === 'una' && alcance.codigo !== codigoSucursal) {
    throw new ForbiddenException('No tienes acceso a esa sucursal.');
  }
}
