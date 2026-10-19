import { LARGO_MAX_NOMBRE_FIRMA } from '@/datos/reglas-firma';

export { LARGO_MAX_NOMBRE_FIRMA };

/**
 * La firma del cliente en la nota (T-73), sin React ni modulos nativos: la
 * tablet no tiene pruebas de pantalla, asi que todo lo que se puede decidir
 * vive aqui y `src/ui/recuadro-firma.tsx` / `src/fotos/firma-expo.ts` solo lo
 * llaman (mismo reparto que `gasto.ts` frente a su pantalla).
 */

/** Un punto del dedo, en coordenadas del recuadro (dp). */
export interface Punto {
  x: number;
  y: number;
}

/** Alto fijo del recuadro; el ancho es el de la tarjeta. */
export const ALTO_RECUADRO_FIRMA = 220;
/** Grosor del trazo, en dp. */
export const GROSOR_TRAZO_FIRMA = 3;
/** Radio del circulo con que se dibuja un toque sin arrastre. */
export const RADIO_PUNTO_FIRMA = 1.5;

/**
 * La firma es un PAPEL: blanco y tinta negra, tambien con el sistema en modo
 * noche. Constantes y no tokens del tema a proposito: el fondo se pinta como un
 * `<Rect>` dentro del `Svg` para que el PNG exportado no salga transparente — un
 * PNG transparente pasa a JPG con fondo negro (Review Focus 1).
 */
export const PAPEL_FIRMA = '#FFFFFF';
export const TINTA_FIRMA = '#000000';

/** El JPG que sube: ancho maximo y calidad (spec, pantalla de venta paso 2). */
export const ANCHO_MAX_FIRMA_PX = 1000;
export const CALIDAD_JPG_FIRMA = 0.8;

/** Lo que se espera a `toDataURL` antes de darlo por fallido (no bloquear Grabar para siempre). */
export const MS_MAX_EXPORTAR_FIRMA = 5000;

/** Error de la firma (exportar, convertir, nombre demasiado largo). */
export class ErrorFirma extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorFirma';
  }
}

/** Una decima basta para el dedo y deja el path corto. */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * El `d` del `<Path>` de un trazo. Un solo punto (toque sin arrastre) es un
 * circulo minimo de dos arcos: un `M x y` solo no pinta nada en Android.
 */
export function trazoAPath(puntos: readonly Punto[]): string {
  const primero = puntos[0];
  if (primero === undefined) return '';
  if (puntos.length === 1) {
    const r = RADIO_PUNTO_FIRMA;
    return `M ${r1(primero.x - r)} ${r1(primero.y)} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
  return puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r1(p.x)} ${r1(p.y)}`).join(' ');
}

/** ¿Hay al menos un punto? Es lo unico que habilita "Grabar venta" (D1). */
export function hayFirma(trazos: readonly (readonly Punto[])[]): boolean {
  return trazos.some((t) => t.length > 0);
}

/**
 * El nombre de quien firma (D2): opcional, recortado; en blanco es `null`.
 * Mas de 80 lanza: el campo ya tiene `maxLength`, esto es la red.
 */
export function normalizarNombreFirma(texto: string): string | null {
  const recortado = texto.trim();
  if (recortado === '') return null;
  if (recortado.length > LARGO_MAX_NOMBRE_FIRMA) {
    throw new ErrorFirma(`El nombre de quien firma no puede pasar de ${LARGO_MAX_NOMBRE_FIRMA} caracteres.`);
  }
  return recortado;
}

/** El ancho al que se reduce el PNG, o `null` si ya cabe. Nunca agranda. */
export function anchoDestinoFirma(anchoPng: number): number | null {
  return anchoPng > ANCHO_MAX_FIRMA_PX ? ANCHO_MAX_FIRMA_PX : null;
}

/**
 * El archivo local de la firma. Sale del id de la venta, que la pantalla genera
 * antes de grabar y conserva mientras siga abierta: reintentar sobrescribe el
 * mismo archivo en vez de dejar huerfanos.
 */
export function nombreArchivoFirma(ventaId: string): string {
  return `firma-${ventaId}.jpg`;
}

/** `toDataURL` puede traer o no el prefijo `data:image/png;base64,`. */
export function quitarPrefijoDataUrl(datos: string): string {
  return datos.replace(/^data:image\/png;base64,/, '');
}

/**
 * La promesa, o un `ErrorFirma(mensaje)` si no llega en `ms`. Para `toDataURL`,
 * que si no llama a su callback dejaria la pantalla esperando para siempre.
 */
export function conLimiteDeTiempo<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new ErrorFirma(mensaje)), ms);
    promesa.then(
      (valor) => {
        clearTimeout(temporizador);
        resolve(valor);
      },
      (error: unknown) => {
        clearTimeout(temporizador);
        reject(error instanceof Error ? error : new ErrorFirma(String(error)));
      },
    );
  });
}
