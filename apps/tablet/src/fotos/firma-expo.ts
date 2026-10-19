/**
 * El adaptador nativo de la firma del cliente (T-73, D5): del PNG de
 * `toDataURL` al JPG que el servidor acepta (`validarFoto` solo admite JPEG).
 *
 * Como `expo.ts`, aqui no hay ni una decision: el ancho, la calidad y el nombre
 * del archivo salen de `@/estado/firma` (probado en Node). Esto solo traduce a
 * `expo-file-system` y `expo-image-manipulator`.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

import {
  anchoDestinoFirma,
  CALIDAD_JPG_FIRMA,
  nombreArchivoFirma,
} from '@/estado/firma';

/**
 * Escribe el PNG en cache, lo convierte a JPG (calidad 0.8, ancho maximo
 * 1000 px) y lo deja en `documentDirectory/firmas/firma-<ventaId>.jpg`, que la
 * limpieza de cache del sistema no toca: la firma tiene que sobrevivir hasta que
 * haya WiFi. Devuelve la URI final.
 *
 * Lanza si algo falla; quien llama (`crearGrabadorVenta`) no graba la venta en
 * ese caso, asi que no se quema folio. Reintentar con el mismo `ventaId`
 * sobrescribe el mismo archivo.
 */
export async function guardarFirmaJpg(ventaId: string, pngBase64: string): Promise<string> {
  const png = new File(Paths.cache, `firma-${ventaId}.png`);
  if (png.exists) png.delete();
  png.write(pngBase64, { encoding: 'base64' });

  const { width } = await Image.getSize(png.uri);
  const contexto = ImageManipulator.manipulate(png.uri);
  const ancho = anchoDestinoFirma(width);
  if (ancho !== null) contexto.resize({ width: ancho });
  const imagen = await contexto.renderAsync();
  const jpg = await imagen.saveAsync({ format: SaveFormat.JPEG, compress: CALIDAD_JPG_FIRMA });

  const carpeta = new Directory(Paths.document, 'firmas');
  carpeta.create({ intermediates: true, idempotent: true });
  const destino = new File(carpeta, nombreArchivoFirma(ventaId));
  if (destino.exists) destino.delete();
  await new File(jpg.uri).move(destino);

  try {
    png.delete();
  } catch {
    // El PNG es solo un paso intermedio en cache: si no se pudo borrar, el
    // sistema lo limpia.
  }
  return destino.uri;
}
