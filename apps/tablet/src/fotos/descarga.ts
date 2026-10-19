/**
 * La foto del cliente en la ficha (T-39, D9): cual pintar y si hay que bajarla
 * del servidor. Puro y probable en Node; el transporte nativo (fetch + disco)
 * esta en `expo.ts` y entra por {@link BajarFoto}.
 *
 * Las fotos de las visitas NO bajan: nadie las necesita en la tablet todavia.
 */

export interface FotoParaFicha {
  /** Que pintar ahora, o `null` ("sin foto"). */
  uri: string | null;
  /** Si hay que pedir la del servidor (una vez por apertura de la ficha). */
  descargar: boolean;
}

export function fotoParaFicha(p: {
  /** La que tomo ESTA tablet al capturar el prospecto (`prospectos.fotoLocalDe`). */
  fotoLocal: string | null;
  /** `cliente.foto_subida_en` (baja en el pull). */
  fotoSubidaEn: string | null;
  /** `cliente.foto_cache_subida_en`: la de la copia que ya esta en cache. */
  cacheSubidaEn: string | null;
  /** Donde vive (o viviria) la copia en cache. */
  uriCache: string;
}): FotoParaFicha {
  if (p.fotoLocal !== null) return { uri: p.fotoLocal, descargar: false };
  if (p.fotoSubidaEn === null) return { uri: null, descargar: false };
  const alDia = p.cacheSubidaEn !== null && Date.parse(p.cacheSubidaEn) >= Date.parse(p.fotoSubidaEn);
  if (alDia) return { uri: p.uriCache, descargar: false };
  // Mas vieja o ninguna: se pinta la vieja (si hay) mientras baja la nueva.
  return { uri: p.cacheSubidaEn !== null ? p.uriCache : null, descargar: true };
}

/**
 * La URI que se le da a `<Image>` para la copia en cache. La foto nueva se
 * escribe en la MISMA ruta (por id) y la cache de imagenes de Android se indexa
 * por URI: sin una version en la URI se seguiria pintando la foto vieja.
 */
export function uriFotoCliente(ruta: string, fotoSubidaEn: string): string {
  return `${ruta}?v=${encodeURIComponent(fotoSubidaEn)}`;
}

/**
 * Baja `url` con el token a `destino` y devuelve el `status`. Escribe el archivo
 * **solo** con un 2xx. Lanza solo si no hubo respuesta (sin red).
 */
export type BajarFoto = (url: string, tokenAcceso: string, destino: string) => Promise<number>;

export type ResultadoDescarga = 'ok' | 'sin-foto' | 'fallo';

/**
 * Pide la foto del cliente al servidor. **Nunca lanza**: sin red, sin sesion o
 * con el servidor caido la ficha sigue diciendo "sin foto", como antes de T-39.
 */
export async function descargarFotoCliente(p: {
  bajar: BajarFoto;
  base: string;
  tokenAcceso: string;
  clienteId: string;
  destino: string;
}): Promise<ResultadoDescarga> {
  try {
    const status = await p.bajar(
      `${p.base}/sync/foto/cliente/${encodeURIComponent(p.clienteId.toLowerCase())}`,
      p.tokenAcceso,
      p.destino,
    );
    if (status >= 200 && status < 300) return 'ok';
    if (status === 404) return 'sin-foto';
    return 'fallo';
  } catch {
    return 'fallo';
  }
}
