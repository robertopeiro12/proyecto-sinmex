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

/**
 * La impresora elegida en "Seleccionar impresora" (rediseno pieza 7b): una
 * termica emparejada por Bluetooth (ESC/POS directo) o el dialogo de Android
 * (`expo-print`, para otra impresora o PDF). `null`: aun no se elige.
 */
export type ImpresoraElegida = { tipo: 'bluetooth'; nombre: string; direccion: string } | { tipo: 'dialogo' };

export const CLAVE_IMPRESORA = 'jawa.impresion.impresora';

function textoNoVacio(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** JSON guardado -> impresora. Nada guardado o cualquier cosa dañada es `null` (hay que volver a elegir). */
export function interpretarImpresora(valor: string | null | undefined): ImpresoraElegida | null {
  if (!valor) return null;
  let dato: unknown;
  try {
    dato = JSON.parse(valor);
  } catch {
    return null;
  }
  if (typeof dato !== 'object' || dato === null || Array.isArray(dato)) return null;
  const o = dato as Record<string, unknown>;
  if (o.tipo === 'dialogo') return { tipo: 'dialogo' };
  if (o.tipo === 'bluetooth' && textoNoVacio(o.nombre) && textoNoVacio(o.direccion)) {
    return { tipo: 'bluetooth', nombre: o.nombre, direccion: o.direccion };
  }
  return null;
}

export function crearPreferenciaImpresora(almacen: AlmacenPreferencia) {
  return {
    async leerImpresora(): Promise<ImpresoraElegida | null> {
      try {
        return interpretarImpresora(await almacen.leer(CLAVE_IMPRESORA));
      } catch {
        return null;
      }
    },
    async guardarImpresora(i: ImpresoraElegida): Promise<void> {
      await almacen.escribir(CLAVE_IMPRESORA, JSON.stringify(i));
    },
  };
}
