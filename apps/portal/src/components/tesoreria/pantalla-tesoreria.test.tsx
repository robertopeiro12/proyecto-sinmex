import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { PantallaTesoreria } from "./pantalla-tesoreria";

vi.mock("@/components/auth/auth-provider");
vi.mock("./pestana-vista", () => ({ PestanaVista: () => <p>panel vista</p> }));
vi.mock("./pestana-movimientos", () => ({ PestanaMovimientos: () => <p>panel movimientos</p> }));
vi.mock("./pestana-cuentas", () => ({ PestanaCuentas: () => <p>panel cuentas</p> }));
vi.mock("./pestana-saldos", () => ({ PestanaSaldos: () => <p>panel saldos</p> }));

function sesion(permisos: string[], cargando = false) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: cargando ? null : ({ sucursal: null, permisos } as never),
    cargando,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}

describe("PantallaTesoreria", () => {
  beforeEach(() => vi.clearAllMocks());

  it("con los dos permisos muestra las tres pestañas y abre en Tesorería", () => {
    sesion(["tesoreria.ver", "tesoreria.gestionar"]);
    render(<PantallaTesoreria sucursal={null} vistaInicial={null} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Tesorería", "Movimientos", "Cuentas", "Saldos"]);
    expect(screen.getByText("panel vista")).toBeVisible();
  });

  it("solo ver: una pestaña", () => {
    sesion(["tesoreria.ver"]);
    render(<PantallaTesoreria sucursal={null} vistaInicial="cuentas" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Tesorería"]);
    expect(screen.queryByText("panel cuentas")).toBeNull();
  });

  it("solo gestionar: Cuentas y Saldos, abre en la de la URL", () => {
    sesion(["tesoreria.gestionar"]);
    render(<PantallaTesoreria sucursal={null} vistaInicial="saldos" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Movimientos", "Cuentas", "Saldos"]);
    expect(screen.getByText("panel saldos")).toBeVisible();
  });

  it("cambiar de pestaña escribe ?vista= en la URL conservando la sucursal", async () => {
    sesion(["tesoreria.ver", "tesoreria.gestionar"]);
    window.history.replaceState(null, "", "/finanzas/tesoreria?sucursal=TJ");
    render(<PantallaTesoreria sucursal="TJ" vistaInicial={null} />);
    await userEvent.click(screen.getByRole("tab", { name: "Cuentas" }));
    expect(window.location.search).toBe("?sucursal=TJ&vista=cuentas");
    expect(screen.getByText("panel cuentas")).toBeVisible();
  });

  it("sin permisos lo dice; mientras carga la sesión dice Cargando", () => {
    sesion([]);
    const { unmount } = render(<PantallaTesoreria sucursal={null} vistaInicial={null} />);
    expect(screen.getByText("No tienes permiso para ver la Tesorería")).toBeInTheDocument();
    unmount();
    sesion([], true);
    render(<PantallaTesoreria sucursal={null} vistaInicial={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });
});
