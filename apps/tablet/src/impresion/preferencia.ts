import type { Papel } from './html';

/**
 * El papel de la impresora (58 o 80 mm) que el vendedor eligio en "Seleccionar
 * impresora". Parte pura: la lectura tolerante y el almacen inyectado.
 *
 * El almacen real (`expo-secure-store`) vive en `preferencia-expo.ts`, separado
 * por la misma razon que `almacen.ts` / `almacen-secure-store.ts`: importar un
 * modulo nativo aqui impediria probar esto en Node.
 */
export const PAPEL_POR_OMISION: Papel = 58;

/** Clave en el almacen. Solo `[A-Za-z0-9._-]`, lo que acepta SecureStore. */
export const CLAVE_PAPEL = 'jawa.impresion.papel';

/** Cualquier cosa que no sea exactamente "80" (nada guardado, basura) es 58. */
export function interpretarPapel(valor: string | null | undefined): Papel {
  return valor === '80' ? 80 : PAPEL_POR_OMISION;
}

export interface AlmacenPreferencia {
  leer(clave: string): Promise<string | null>;
  escribir(clave: string, valor: string): Promise<void>;
}

export function crearPreferenciaPapel(almacen: AlmacenPreferencia) {
  return {
    async leerPapel(): Promise<Papel> {
      try {
        return interpretarPapel(await almacen.leer(CLAVE_PAPEL));
      } catch {
        // Un almacen ilegible no deja al vendedor sin imprimir: papel angosto.
        return PAPEL_POR_OMISION;
      }
    },
    async guardarPapel(p: Papel): Promise<void> {
      await almacen.escribir(CLAVE_PAPEL, String(p));
    },
  };
}
