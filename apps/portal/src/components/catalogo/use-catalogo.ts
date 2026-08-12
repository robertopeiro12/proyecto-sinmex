"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** null = formulario cerrado · "nueva" = alta · un item = edicion. */
export type Edicion<T> = T | "nueva" | null;

export interface Catalogo<T> {
  items: T[];
  cargando: boolean;
  error: string | null;
  edicion: Edicion<T>;
  abrirAlta: () => void;
  abrirEdicion: (item: T) => void;
  cerrar: () => void;
  recargar: () => Promise<void>;
}

/**
 * El estado que comparten todas las pantallas de catalogo del portal: cargar,
 * mostrar el fallo, y saber si el formulario esta abierto y sobre que.
 *
 * `cargar` se guarda en un ref y NO va en las dependencias del efecto. Casi
 * todos los llamadores la pasan inline (`() => listarProductos()`), que cambia
 * de identidad en cada render; metida en las deps eso es un bucle infinito de
 * peticiones. Para recargar cuando cambie algo de verdad, usa `deps`.
 */
export function useCatalogo<T>(
  cargar: () => Promise<T[]>,
  { mensajeError, deps = [] }: { mensajeError: string; deps?: unknown[] },
): Catalogo<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion<T>>(null);

  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  const recargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setItems(await cargarRef.current());
    } catch {
      // Un 401 aqui ya lo maneja apiFetch (refresca) y AuthProvider (rebota al
      // login). Lo que queda son fallos de red o 5xx, y para esos lo unico
      // honesto es decir que no se pudo cargar.
      setError(mensajeError);
    } finally {
      setCargando(false);
    }
  }, [mensajeError]);

  useEffect(() => {
    void recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recargar, ...deps]);

  return {
    items,
    cargando,
    error,
    edicion,
    abrirAlta: useCallback(() => setEdicion("nueva"), []),
    abrirEdicion: useCallback((item: T) => setEdicion(item), []),
    cerrar: useCallback(() => setEdicion(null), []),
    recargar,
  };
}
