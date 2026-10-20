"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import type { UsuarioSesion } from "@/lib/api";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { colorDeSucursal, siglasDeSucursal } from "@/lib/sucursal-color";

/** Mismo valor reservado que usa el backend en alcance-sucursal.ts. */
const TODAS = "todas";

export const NOMBRE_TODAS = "Todas las sucursales";

export interface SucursalActual {
  /** `null` = todas las sucursales. */
  codigo: string | null;
  nombre: string;
  siglas: string;
  color: string;
  /** Un General con más de una sucursal activa. */
  puedeElegir: boolean;
  /** Las sucursales activas que puede elegir. */
  opciones: Sucursal[];
  /** `null` = todas: quita `?sucursal=` de la dirección. */
  elegir: (codigo: string | null) => void;
}

/**
 * Qué sucursal se está viendo (UI Etapa 1, spec §3.2). Por dentro funciona igual que el
 * selector de antes: `?sucursal=` en la dirección, sin parámetro = todas. Un usuario
 * atado ve siempre la suya (el backend ignora el parámetro para él).
 */
export function useSucursalActual(usuarioVisible?: UsuarioSesion | null): SucursalActual {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { usuario: usuarioAuth } = useAuth();
  // El marco pasa `null` hasta montar, para que el primer render del cliente coincida con el del servidor.
  const usuario = usuarioVisible === undefined ? usuarioAuth : usuarioVisible;
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const hayUsuario = usuario !== null;

  useEffect(() => {
    if (!hayUsuario) return;
    let vigente = true;
    // Sin filtro a propósito: hace falta todo lo que el usuario puede elegir, no lo que
    // está viendo ahora mismo. El backend ya lo acota a lo que le toca.
    listarSucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista);
      })
      .catch(() => {
        if (vigente) setSucursales([]);
      });
    return () => {
      vigente = false;
    };
  }, [hayUsuario]);

  const elegir = useCallback(
    (codigo: string | null) => {
      const nuevos = new URLSearchParams(params.toString());
      // "todas" es el default: se quita el parámetro en vez de escribirlo (la URL queda
      // limpia y ?sucursal= nunca aparece vacío).
      if (codigo === null) nuevos.delete("sucursal");
      else nuevos.set("sucursal", codigo);
      const query = nuevos.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [params, pathname, router],
  );

  const activas = sucursales.filter((s) => s.activa);
  const pedida = params.get("sucursal");

  let codigo: string | null = null;
  let nombre = NOMBRE_TODAS;
  if (usuario?.sucursal) {
    codigo = usuario.sucursal.codigo;
    nombre = usuario.sucursal.nombre;
  } else if (pedida && pedida.toLowerCase() !== TODAS) {
    const encontrada = sucursales.find((s) => s.codigo.toLowerCase() === pedida.toLowerCase());
    codigo = encontrada?.codigo ?? pedida.toUpperCase();
    nombre = encontrada?.nombre ?? codigo;
  }

  return {
    codigo,
    nombre,
    siglas: siglasDeSucursal(codigo),
    color: colorDeSucursal(codigo),
    puedeElegir: !usuario?.sucursal && activas.length > 1,
    opciones: activas,
    elegir,
  };
}
