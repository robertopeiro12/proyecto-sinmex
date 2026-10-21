import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { PantallaTesoreria } from "./pantalla-tesoreria";

vi.mock("@/components/auth/auth-provider");
const propsVista = vi.fn();
vi.mock("./pestana-vista", () => ({
  PestanaVista: (props: { activa?: boolean }) => {
    propsVista(props);
    return <p>panel vista</p>;
  },
}));
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
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/finanzas/tesoreria");
  });

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

  it("encabezado común: h1 Tesorería con su descripción", () => {
    sesion(["tesoreria.ver"]);
    render(<PantallaTesoreria sucursal={null} vistaInicial={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Tesorería" })).toBeInTheDocument();
    expect(
      screen.getByText("Las cuentas del negocio con su saldo, sus depósitos, retiros y traspasos, y la cobranza que entra sola."),
    ).toBeInTheDocument();
  });

  it("las flechas cambian de pestaña y escriben ?vista=", async () => {
    sesion(["tesoreria.ver", "tesoreria.gestionar"]);
    render(<PantallaTesoreria sucursal={null} vistaInicial={null} />);
    screen.getByRole("tab", { name: "Tesorería" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(window.location.search).toBe("?vista=movimientos");
    expect(screen.getByText("panel movimientos")).toBeVisible();
  });

  it("la vista no se desmonta y al volver a Tesorería se le avisa que está activa de nuevo", async () => {
    sesion(["tesoreria.ver", "tesoreria.gestionar"]);
    render(<PantallaTesoreria sucursal={null} vistaInicial={null} />);
    expect(propsVista).toHaveBeenLastCalledWith({ sucursal: null, activa: true });
    await userEvent.click(screen.getByRole("tab", { name: "Saldos" }));
    expect(propsVista).toHaveBeenLastCalledWith({ sucursal: null, activa: false });
    expect(screen.getByText("panel vista")).toBeInTheDocument();
    expect(screen.getByText("panel saldos")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Tesorería" }));
    expect(propsVista).toHaveBeenLastCalledWith({ sucursal: null, activa: true });
    expect(screen.queryByText("panel saldos")).toBeNull();
  });

  it("solo hay tabs de las permitidas y la lista lleva nombre", () => {
    sesion(["tesoreria.ver"]);
    render(<PantallaTesoreria sucursal={null} vistaInicial={null} />);
    const lista = screen.getByRole("tablist", { name: "Tesorería" });
    expect(within(lista).getAllByRole("tab")).toHaveLength(1);
  });

  it("sin permisos lo dice; mientras carga la sesión dice Cargando, con el título", () => {
    sesion([]);
    const { unmount } = render(<PantallaTesoreria sucursal={null} vistaInicial={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Tesorería" })).toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    unmount();
    sesion([], true);
    render(<PantallaTesoreria sucursal={null} vistaInicial={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Tesorería" })).toBeInTheDocument();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });
});
