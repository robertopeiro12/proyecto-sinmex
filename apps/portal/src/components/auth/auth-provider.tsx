"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, ErrorApi, type UsuarioSesion } from "@/lib/api";

interface ContextoAuth {
  usuario: UsuarioSesion | null;
  cargando: boolean;
  cerrarSesion: () => Promise<void>;
}

const Contexto = createContext<ContextoAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;

    apiFetch<UsuarioSesion>("/auth/me")
      .then((u) => {
        if (vigente) setUsuario(u);
      })
      .catch((error: unknown) => {
        // El middleware deja pasar con la cookie presente aunque este vencida;
        // aqui es donde nos enteramos de verdad. Solo rebotamos al login si la
        // API dijo 401: una caida de red no debe sacar al usuario de la sesion.
        if (error instanceof ErrorApi && error.status === 401) {
          router.replace("/login");
        }
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });

    return () => {
      vigente = false;
    };
  }, [router]);

  const cerrarSesion = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Se ignora a proposito. Si la API no contesta (red caida, backend
      // abajo) no hay nada util que decirle al usuario: el finally ya limpia
      // la sesion local y lo manda al login, que es lo que pidio. La sesion
      // del servidor seguiria viva, pero muere sola al vencer el refresh.
      //
      // El catch existe sobre todo porque quien invoca esto lo hace con
      // `void cerrarSesion()`, que descarta la promesa: sin este catch, un
      // logout fallido se convertia en un unhandledrejection en la consola
      // del navegador aunque el comportamiento visible fuera correcto.
    } finally {
      setUsuario(null);
      router.replace("/login");
      router.refresh();
    }
  }, [router]);

  return (
    <Contexto.Provider value={{ usuario, cargando, cerrarSesion }}>{children}</Contexto.Provider>
  );
}

export function useAuth(): ContextoAuth {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error("useAuth debe usarse dentro de AuthProvider.");
  }
  return contexto;
}
