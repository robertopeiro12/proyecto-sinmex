import { SetMetadata } from '@nestjs/common';

export const ES_APP = 'es_app';

/**
 * Marca un endpoint como **de la app de tablet**: exige un JWT de vendedor en
 * `Authorization: Bearer`, no la cookie del portal.
 *
 * Existe para que el guard global sea estricto en LOS DOS sentidos. Sin esta
 * marca, el guard tendria que aceptar cualquiera de los dos actores en
 * cualquier endpoint y confiar en que cada controller compruebe cual le toco —
 * es decir, exactamente el tipo de comprobacion que un dia alguien olvida.
 *
 * Con ella el reparto no tiene zona gris:
 *
 * - sin marca  → portal: cookie + `tipo: 'usuario'`.
 * - `@SoloApp()` → app: Bearer + `tipo: 'vendedor'`.
 * - `@Publico()` → sin sesion.
 *
 * Un token de app en un endpoint del portal no pasa (el portal ni siquiera
 * mira el header), y un token del portal en un endpoint de app tampoco (falla
 * el chequeo de `tipo`). Ninguno de los dos depende de que el controller se
 * acuerde de nada.
 */
export const SoloApp = () => SetMetadata(ES_APP, true);
