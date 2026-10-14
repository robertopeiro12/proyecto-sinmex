import type {
  AudienciaPromocion,
  CompraPromocion,
  RegaloPromocion,
} from '../sincronizacion/contrato';

/** La regla, ya en camelCase (como la devuelve la API del portal). */
export interface ReglaPromocion {
  audiencia: AudienciaPromocion;
  compraTipo: CompraPromocion;
  compraCantidad: number;
  regaloTipo: RegaloPromocion;
  regaloCantidad: number;
  seRepite: boolean;
}

/**
 * Los nombres ya resueltos: el del producto, o "producto volumen" de la
 * presentacion. `null` cuando no aplica (compra `cualquiera`, regalo `mismo`)
 * o cuando no se pudo resolver.
 */
export interface NombresPromocion {
  compra: string | null;
  regalo: string | null;
}

/**
 * La frase que ven la oficina y el vendedor, y la que se congela en la nota
 * (T-74, D11, D12). Una sola forma de decirlo en los tres lados: esta funcion
 * esta DUPLICADA a proposito en la tablet (`src/datos/promociones-reglas.ts`) y
 * en el portal (`lib/promociones.ts`), con las mismas pruebas, porque ninguno de
 * los dos puede importar del backend.
 *
 * - Se repite: "Por cada N X, M Y gratis". Una vez: "Al comprar N X, M Y gratis (una vez)".
 * - Compra `cualquiera`: "pieza" si N = 1, "N piezas de lo que sea" si no.
 * - Regalo `mismo`: el nombre de la compra.
 * - Prospecto: prefijo "Bienvenida al prospecto:" y sufijo "en su primera venta";
 *   con compra 0 no hay compra que nombrar.
 */
export function textoPromocion(
  regla: ReglaPromocion,
  nombres: NombresPromocion,
): string {
  const hueco = '(producto)';
  const compra =
    regla.compraTipo === 'cualquiera'
      ? regla.compraCantidad === 1
        ? 'pieza'
        : `${regla.compraCantidad} piezas de lo que sea`
      : `${regla.compraCantidad} ${nombres.compra ?? hueco}`;
  const regalo = `${regla.regaloCantidad} ${
    regla.regaloTipo === 'mismo'
      ? (nombres.compra ?? hueco)
      : (nombres.regalo ?? hueco)
  } gratis`;

  if (regla.audiencia === 'prospecto') {
    if (regla.compraCantidad === 0) {
      return `Bienvenida al prospecto: ${regalo} en su primera venta`;
    }
    return `Bienvenida al prospecto: al comprar ${compra}, ${regalo} en su primera venta`;
  }
  return regla.seRepite
    ? `Por cada ${compra}, ${regalo}`
    : `Al comprar ${compra}, ${regalo} (una vez)`;
}
