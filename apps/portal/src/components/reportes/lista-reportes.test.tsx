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

  it("encabezado de nivel 1 con su descripción y un enlace por reporte con su explicación", () => {
    mockAuth((clave) => clave === "reportes.ver");
    render(<ListaReportes sucursal={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Reportes" })).toBeInTheDocument();
    expect(screen.getByText("Los reportes del negocio que se pueden consultar y exportar a Excel.")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByText("Kilómetros por vehículo y día, con los saltos entre jornadas. Exportable a Excel.")).toBeInTheDocument();
    expect(
      screen.getByText("Clientes dados de alta (o convertidos de prospecto) en un rango, con el usuario que los dio de alta. Exportable a Excel."),
    ).toBeInTheDocument();
  });

  it("sin reportes.ver lo dice", () => {
    mockAuth(() => false);
    render(<ListaReportes sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
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

  it("enlaza Clientes nuevos conservando la sucursal del filtro global", () => {
    mockAuth((clave) => clave === "reportes.ver");
    render(<ListaReportes sucursal="TJ" />);
    expect(screen.getByRole("link", { name: "Clientes nuevos" })).toHaveAttribute(
      "href",
      "/informacion/reportes/clientes-nuevos?sucursal=TJ",
    );
  });
});
