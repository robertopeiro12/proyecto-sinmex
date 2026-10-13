import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ListaReportes } from "./lista-reportes";

vi.mock("@/components/auth/auth-provider");
// next/link fuera del router de Next: un <a> basta para la prueba.
vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

describe("ListaReportes", () => {
  it("mientras carga la sesión dice Cargando…, no \"No tienes permiso\"", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<ListaReportes sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin reportes.ver lo dice", () => {
    mockAuth(() => false);
    render(<ListaReportes sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver reportes")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Kilometraje" })).not.toBeInTheDocument();
  });

  it("enlaza Kilometraje conservando la sucursal del filtro global", () => {
    mockAuth((clave) => clave === "reportes.ver");
    render(<ListaReportes sucursal="TJ" />);
    expect(screen.getByRole("link", { name: "Kilometraje" })).toHaveAttribute(
      "href",
      "/informacion/reportes/kilometraje?sucursal=TJ",
    );
  });
});
