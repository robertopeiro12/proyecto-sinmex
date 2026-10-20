import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useAuth } from "@/components/auth/auth-provider";
import PortalLayout from "./layout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/operacion/ventas",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn().mockResolvedValue({ id: "u1", login: "a", nombre: "Admin Local", perfil: "Administrador General", sucursal: null, permisos: [] }),
}));
vi.mock("@/lib/sucursales", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales")>()),
  listarSucursales: vi.fn().mockResolvedValue([]),
}));

function Pantalla() {
  const { usuario } = useAuth();
  return <p>{usuario ? "con sesion" : "sin sesion"}</p>;
}

describe("PortalLayout", () => {
  it("la pantalla y el marco comparten la sesión: empiezan sin usuario y luego lo ven", async () => {
    // Lo que pinta el servidor (sin efectos): sin sesión en la pantalla ni en el marco.
    const html = renderToString(
      <PortalLayout>
        <Pantalla />
      </PortalLayout>,
    );
    expect(html).toContain("sin sesion");
    expect(html).not.toContain("Abrir opciones");

    render(
      <PortalLayout>
        <Pantalla />
      </PortalLayout>,
    );
    expect(await screen.findByText("con sesion")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Admin Local/ })).toBeInTheDocument();
  });
});
