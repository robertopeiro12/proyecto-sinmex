"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

export function FormularioLogin() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
      });
      router.replace("/operacion");
      router.refresh();
    } catch {
      // Mensaje generico a proposito: no confirmamos si el login existe.
      setError("Usuario o contrasena incorrectos.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login" className="text-sm font-medium">
          Usuario
        </label>
        <input
          id="login"
          name="login"
          autoComplete="username"
          required
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
