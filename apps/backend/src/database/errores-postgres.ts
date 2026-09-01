/**
 * El driver `pg` adjunta el codigo de error de Postgres en `error.code`
 * cuando la base rechaza una escritura. Se mira DESPUES del insert/update en
 * vez de consultar antes (por ejemplo, si un nombre ya existe): una consulta
 * previa deja una ventana entre el SELECT y el INSERT en la que otra
 * peticion puede meter lo mismo, y el constraint de la base es quien de
 * verdad decide (mismo criterio que T-09, T-10, T-11, T-14, T-18).
 *
 * Extraido en T-12 porque `TiposNegocioService` (unique de nombre) y
 * `ClientesService` (llaves foraneas de tipo_negocio/lista_precio) iban a
 * ser la cuarta y quinta copia de esta funcion -- T-10 ya habia anotado ese
 * umbral como el momento de extraerla. Los tres servicios que ya la tenian
 * duplicada (`perfiles.service.ts`, `productos.service.ts`,
 * `vehiculos.service.ts`) no se tocan aqui: solo el codigo nuevo la usa.
 */
function codigoDeError(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const valor = (error as { code?: unknown }).code;
  return typeof valor === 'string' ? valor : undefined;
}

/** `23505` es unique_violation. */
export function esViolacionUnicidad(error: unknown): boolean {
  return codigoDeError(error) === '23505';
}

/** `23503` es foreign_key_violation. */
export function esViolacionFk(error: unknown): boolean {
  return codigoDeError(error) === '23503';
}
