import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as ops from "@/lib/operaciones-almacen";
import type { OperacionAlmacen } from "@/lib/operaciones-almacen";
import * as peticionesLib from "@/lib/peticiones";
import { PantallaPeticiones } from "./pantalla-peticiones";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return { ...real, listarPeticiones: vi.fn() };
});
vi.mock("@/lib/operaciones-almacen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/operaciones-almacen")>();
  return { ...real, listarRetirosPendientes: vi.fn(), autorizarRetiro: vi.fn(), rechazarRetiro: vi.fn() };
});

const retiro = (id: string, m: Partial<OperacionAlmacen> = {}): OperacionAlmacen => ({
  id,
  tipo: "retiro_merma",
  sucursal: { id: "s-TJ", codigo: "TJ" },
  fecha: "2026-11-24",
  origen: null,
  destino: null,
  motivo: null,
  trabajador: null,
  comentario: null,
  lineas: [
    { presentacionId: "p1", nombre: "Horchata 1 L", producto: "Horchata", volumen: "1 L", piezas: 12 },
    { presentacionId: "p2", nombre: "Jamaica 1 L", producto: "Jamaica", volumen: "1 L", piezas: 3 },
  ],
  piezas: 15,
  capturo: "Lupe",
  hora: "08:15",
  actualizadoEn: "2026-11-24T16:15:00.123456Z",
  editable: true,
  envio: null,
  estado: "pendiente",
  resolucion: null,
  ...m,
});

function mockAuth(puede: (c: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

async function abrirPestana(sucursal: string | null = "TJ") {
  const u = userEvent.setup();
  render(<PantallaPeticiones sucursal={sucursal} />);
  await u.click(screen.getByRole("tab", { name: "Retiro de merma" }));
  return u;
}

describe("Peticiones › Retiro de merma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(() => true);
    vi.mocked(peticionesLib.listarPeticiones).mockResolvedValue([]);
    vi.mocked(ops.listarRetirosPendientes).mockResolvedValue({ retiros: [retiro("r1")] });
  });

  it("lista los pendientes con sucursal, fecha, quién pidió, piezas y productos", async () => {
    await abrirPestana("TJ");
    const fila = within(await screen.findByRole("row", { name: /Lupe/ }));
    expect(fila.getByText("TJ")).toBeInTheDocument();
    expect(fila.getByText("24/11/2026")).toBeInTheDocument();
    expect(fila.getByText(/Lupe/)).toBeInTheDocument();
    expect(fila.getByText("15")).toBeInTheDocument();
    expect(fila.getByText("Horchata 1 L × 12, Jamaica 1 L × 3")).toBeInTheDocument();
    expect(ops.listarRetirosPendientes).toHaveBeenCalledWith("TJ");
  });

  it("sin peticiones.gestionar no hay pantalla ni se pide nada", () => {
    mockAuth(() => false);
    render(<PantallaPeticiones sucursal="TJ" />);
    expect(screen.queryByRole("tab", { name: "Retiro de merma" })).toBeNull();
    expect(ops.listarRetirosPendientes).not.toHaveBeenCalled();
  });

  it("Autorizar confirma y recarga la lista", async () => {
    const u = await abrirPestana();
    vi.mocked(ops.autorizarRetiro).mockResolvedValue(retiro("r1", { estado: "autorizado" }));
    await u.click(await screen.findByRole("button", { name: /Autorizar retiro/ }));
    expect(ops.autorizarRetiro).not.toHaveBeenCalled();
    vi.mocked(ops.listarRetirosPendientes).mockResolvedValue({ retiros: [] });
    await u.click(await screen.findByRole("button", { name: "Autorizar retiro" }));
    await waitFor(() => expect(ops.autorizarRetiro).toHaveBeenCalledWith("r1", "2026-11-24T16:15:00.123456Z"));
    expect(await screen.findByText("No hay retiros de merma pendientes.")).toBeInTheDocument();
  });

  it("Rechazar exige motivo, lo recorta y lo manda", async () => {
    const u = await abrirPestana();
    vi.mocked(ops.rechazarRetiro).mockResolvedValue(retiro("r1", { estado: "rechazado" }));
    await u.click(await screen.findByRole("button", { name: /Rechazar retiro/ }));
    const enviar = screen.getByRole("button", { name: "Confirmar rechazo" });
    expect(enviar).toBeDisabled();
    await u.type(screen.getByLabelText("Motivo"), "   ");
    expect(enviar).toBeDisabled();
    await u.type(screen.getByLabelText("Motivo"), " Faltan fotos ");
    expect(screen.getByLabelText("Motivo")).toHaveAttribute("maxlength", "300");
    vi.mocked(ops.listarRetirosPendientes).mockResolvedValue({ retiros: [] });
    await u.click(enviar);
    await waitFor(() => expect(ops.rechazarRetiro).toHaveBeenCalledWith("r1", "Faltan fotos", "2026-11-24T16:15:00.123456Z"));
    expect(await screen.findByText("No hay retiros de merma pendientes.")).toBeInTheDocument();
  });

  it("un 409 muestra el mensaje en rojo y recarga", async () => {
    const u = await abrirPestana();
    vi.mocked(ops.autorizarRetiro).mockRejectedValue(new ErrorApi("conflicto", 409, "Ese retiro ya no está pendiente."));
    await u.click(await screen.findByRole("button", { name: /Autorizar retiro/ }));
    await u.click(await screen.findByRole("button", { name: "Autorizar retiro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ese retiro ya no está pendiente.");
    await waitFor(() => expect(ops.listarRetirosPendientes).toHaveBeenCalledTimes(2));
  });

  it("un 404 al autorizar muestra el mensaje y recarga", async () => {
    const u = await abrirPestana();
    vi.mocked(ops.autorizarRetiro).mockRejectedValue(new ErrorApi("no existe", 404, "No existe esa operación."));
    await u.click(await screen.findByRole("button", { name: /Autorizar retiro/ }));
    await u.click(await screen.findByRole("button", { name: "Autorizar retiro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No existe esa operación.");
    await waitFor(() => expect(ops.listarRetirosPendientes).toHaveBeenCalledTimes(2));
  });

  it("un 404 al rechazar cierra la ventana y recarga", async () => {
    const u = await abrirPestana();
    vi.mocked(ops.rechazarRetiro).mockRejectedValue(new ErrorApi("no existe", 404, "No existe esa operación."));
    await u.click(await screen.findByRole("button", { name: /Rechazar retiro/ }));
    await u.type(screen.getByLabelText("Motivo"), "No");
    await u.click(screen.getByRole("button", { name: "Confirmar rechazo" }));
    await waitFor(() => expect(ops.listarRetirosPendientes).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent("No existe esa operación.");
  });

  it("muestra el comentario del retiro y cuándo se pidió en formato largo", async () => {
    vi.mocked(ops.listarRetirosPendientes).mockResolvedValue({ retiros: [retiro("r1", { comentario: "Se cayó una tarima" })] });
    await abrirPestana();
    const fila = within(await screen.findByRole("row", { name: /Lupe/ }));
    expect(fila.getByText("Se cayó una tarima")).toBeInTheDocument();
    expect(fila.getByText("Lupe el martes 24 de noviembre a las 08:15")).toBeInTheDocument();
  });

  it("al cambiar de sucursal no se ven los retiros de la anterior mientras carga", async () => {
    vi.mocked(peticionesLib.listarPeticiones).mockResolvedValue([]);
    const u = userEvent.setup();
    const { rerender } = render(<PantallaPeticiones sucursal="TJ" />);
    await u.click(screen.getByRole("tab", { name: "Retiro de merma" }));
    expect(await screen.findByRole("row", { name: /Lupe/ })).toBeInTheDocument();
    vi.mocked(ops.listarRetirosPendientes).mockReturnValue(new Promise(() => {}));
    rerender(<PantallaPeticiones sucursal="MX" />);
    expect(screen.queryByRole("row", { name: /Lupe/ })).toBeNull();
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });
});
