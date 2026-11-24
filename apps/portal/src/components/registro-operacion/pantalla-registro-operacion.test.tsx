import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import { diaAnterior } from "@/lib/fechas";
import * as ops from "@/lib/operaciones-almacen";
import type { OperacionAlmacen } from "@/lib/operaciones-almacen";
import * as motivosLib from "@/lib/motivos-merma";
import * as productosLib from "@/lib/productos";
import * as sucursalesLib from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaRegistroOperacion } from "./pantalla-registro-operacion";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/operaciones-almacen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/operaciones-almacen")>();
  return {
    ...real,
    listarOperaciones: vi.fn(),
    crearOperacion: vi.fn(),
    editarOperacion: vi.fn(),
    eliminarOperacion: vi.fn(),
  };
});
vi.mock("@/lib/motivos-merma", () => ({ listarMotivosMerma: vi.fn() }));
vi.mock("@/lib/productos", () => ({ listarProductos: vi.fn() }));
vi.mock("@/lib/sucursales", () => ({ listarSucursales: vi.fn() }));

const HOY = hoyEnTijuana();
const TODOS = ["operacion.entrada", "operacion.envio", "operacion.merma", "operacion.consumo", "operacion.descuento"];

function mockAuth(permisos: string[], codigo: string | null = "TJ") {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1",
      login: "ana",
      nombre: "Ana",
      perfil: "Administrador General",
      sucursal: codigo ? { id: "s", codigo, nombre: codigo } : null,
      permisos,
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (c: string) => permisos.includes(c),
  });
}

const op = (id: string, tipo: OperacionAlmacen["tipo"], m: Partial<OperacionAlmacen> = {}): OperacionAlmacen => ({
  id,
  tipo,
  sucursal: { id: "s-TJ", codigo: "TJ" },
  fecha: HOY,
  origen: null,
  destino: null,
  motivo: null,
  trabajador: null,
  comentario: null,
  lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", producto: "Horchata", volumen: "1 L", piezas: 12 }],
  piezas: 12,
  capturo: "Lupe",
  hora: "08:15",
  editable: true,
  envio: null,
  ...m,
});

const dia = (operaciones: OperacionAlmacen[], fecha = HOY) => ({ fecha, hoy: HOY, operaciones });

const suc = (codigo: string, nombre: string) => ({
  id: `s-${codigo}`,
  codigo,
  nombre,
  activa: true,
  controlInventario: false,
  consumoDiarioMax: 1,
});

describe("PantallaRegistroOperacion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ops.listarOperaciones).mockResolvedValue(dia([]));
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([suc("TJ", "Tijuana"), suc("MX", "Mexicali")]);
    vi.mocked(motivosLib.listarMotivosMerma).mockResolvedValue([
      { id: "m1", nombre: "Caducado por fecha", aplicaAlmacen: true, aplicaCliente: true, aplicaVehiculo: true, activo: true },
    ]);
    vi.mocked(productosLib.listarProductos).mockResolvedValue([
      {
        id: "pr1",
        nombre: "Horchata",
        activo: true,
        presentaciones: [
          { id: "p1", volumen: "1 L" },
          { id: "p2", volumen: "500 ml" },
        ],
      },
      { id: "pr2", nombre: "Jamaica", activo: true, presentaciones: [{ id: "p3", volumen: "1 L" }] },
      { id: "pr3", nombre: "Viejo", activo: false, presentaciones: [{ id: "p4", volumen: "1 L" }] },
    ]);
  });

  it("sin ningún permiso de operación no hay pantalla", () => {
    mockAuth(["otro"]);
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(ops.listarOperaciones).not.toHaveBeenCalled();
  });

  it("solo salen las pestañas con permiso y la inicial sale de ?pestana=", async () => {
    mockAuth(["operacion.entrada", "operacion.merma"]);
    render(<PantallaRegistroOperacion sucursal={null} pestana="merma" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Entradas/Compras", "Merma"]);
    expect(screen.getByRole("tab", { name: "Merma" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(ops.listarOperaciones).toHaveBeenCalledWith({ fecha: HOY, tipo: "merma", sucursal: "TJ" }));
  });

  it("con todas las sucursales pide elegir una", () => {
    mockAuth(TODOS, null);
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    expect(screen.getByText(/Elige una sucursal/)).toBeInTheDocument();
    expect(ops.listarOperaciones).not.toHaveBeenCalled();
  });

  it("un General usa la sucursal del selector", async () => {
    mockAuth(TODOS, null);
    render(<PantallaRegistroOperacion sucursal="mx" pestana={null} />);
    await waitFor(() => expect(ops.listarOperaciones).toHaveBeenCalledWith({ fecha: HOY, tipo: "entrada", sucursal: "MX" }));
  });

  it("lista con hora, quién, piezas y el dato del tipo", async () => {
    mockAuth(TODOS);
    vi.mocked(ops.listarOperaciones).mockResolvedValue(dia([op("o1", "entrada", { origen: "compra" })]));
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    const fila = within(await screen.findByRole("row", { name: /Lupe/ }));
    expect(fila.getByText("08:15")).toBeInTheDocument();
    expect(fila.getByText("12")).toBeInTheDocument();
    expect(fila.getByText("Compra")).toBeInTheDocument();
    expect(fila.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("muestra destino, motivo y trabajador según el pestaña", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    vi.mocked(ops.listarOperaciones).mockImplementation(async ({ tipo }) =>
      dia(
        tipo === "envio"
          ? [op("e", "envio", { destino: { id: "s-MX", codigo: "MX" } })]
          : tipo === "merma"
            ? [op("m", "merma", { motivo: { id: "m1", nombre: "Caducado por fecha" } })]
            : tipo === "descuento"
              ? [op("d", "descuento", { trabajador: "Pedro" })]
              : [],
      ),
    );
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    await u.click(screen.getByRole("tab", { name: "Envíos" }));
    expect(await screen.findByText("MX")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Merma" }));
    expect(await screen.findByText("Caducado por fecha")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Descuentos" }));
    expect(await screen.findByText("Pedro")).toBeInTheDocument();
  });

  it("un envío visto en Entradas es de solo lectura", async () => {
    mockAuth(TODOS);
    vi.mocked(ops.listarOperaciones).mockResolvedValue(
      dia([op("e", "envio", { editable: false, envio: { origen: { id: "s-MX", codigo: "MX" } } })]),
    );
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    const fila = within(await screen.findByRole("row", { name: /Lupe/ }));
    expect(fila.getByText("Envío desde MX")).toBeInTheDocument();
    expect(fila.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(fila.queryByRole("button", { name: "Eliminar" })).toBeNull();
  });

  it("Ayer cambia el día; Envíos no ofrece días anteriores a ayer", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    await screen.findByLabelText("Día");
    await u.click(screen.getByRole("button", { name: "Ayer" }));
    await waitFor(() =>
      expect(ops.listarOperaciones).toHaveBeenLastCalledWith({ fecha: diaAnterior(HOY), tipo: "entrada", sucursal: "TJ" }),
    );
    await u.click(screen.getByRole("tab", { name: "Envíos" }));
    const campo = await screen.findByLabelText("Día");
    expect(campo).toHaveAttribute("min", diaAnterior(HOY));
    expect(campo).toHaveAttribute("max", HOY);
  });

  describe("captura", () => {
    it("abre con todos los productos activos por tamaño, TAB avanza, vacío = sin línea", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      vi.mocked(ops.crearOperacion).mockResolvedValue(op("n", "entrada"));
      render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
      await u.click(await screen.findByRole("button", { name: "Registrar entrada" }));
      expect(await screen.findByRole("button", { name: "← Volver a Entradas/Compras" })).toBeInTheDocument();
      const campos = await screen.findAllByRole("textbox", { name: /piezas/i });
      expect(campos.map((c) => c.getAttribute("aria-label"))).toEqual([
        "Piezas de Horchata 500 ml",
        "Piezas de Horchata 1 L",
        "Piezas de Jamaica 1 L",
      ]);
      expect(screen.queryByText("Viejo")).toBeNull();
      const guardar = screen.getByRole("button", { name: "Guardar" });
      expect(guardar).toBeDisabled();
      await u.click(campos[0]);
      await u.keyboard("5");
      await u.tab();
      expect(campos[1]).toHaveFocus();
      await u.tab();
      expect(campos[2]).toHaveFocus();
      await u.keyboard("7");
      expect(guardar).toBeEnabled();
      await u.click(guardar);
      await waitFor(() =>
        expect(ops.crearOperacion).toHaveBeenCalledWith({
          tipo: "entrada",
          sucursal: "TJ",
          fecha: HOY,
          origen: "produccion",
          comentario: null,
          lineas: [
            { presentacionId: "p2", piezas: 5 },
            { presentacionId: "p3", piezas: 7 },
          ],
        }),
      );
      // vuelve a la lista
      expect(await screen.findByRole("button", { name: "Registrar entrada" })).toBeInTheDocument();
    });

    it("Entradas ofrece Producción y Compra", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      vi.mocked(ops.crearOperacion).mockResolvedValue(op("n", "entrada"));
      render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
      await u.click(await screen.findByRole("button", { name: "Registrar entrada" }));
      const origen = await screen.findByLabelText("Origen");
      expect(within(origen).getAllByRole("option").map((o) => o.textContent)).toEqual(["Producción", "Compra"]);
      await u.selectOptions(origen, "compra");
      await u.type((await screen.findAllByRole("textbox", { name: /piezas/i }))[0], "2");
      await u.type(screen.getByLabelText(/Comentario/), "Factura 12");
      await u.click(screen.getByRole("button", { name: "Guardar" }));
      await waitFor(() =>
        expect(ops.crearOperacion).toHaveBeenCalledWith(
          expect.objectContaining({ origen: "compra", comentario: "Factura 12" }),
        ),
      );
    });

    it("Envío pide destino sin la propia sucursal", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      render(<PantallaRegistroOperacion sucursal={null} pestana="envio" />);
      await u.click(await screen.findByRole("button", { name: "Registrar envío" }));
      const destino = await screen.findByLabelText("Sucursal destino");
      await waitFor(() =>
        expect(within(destino).getAllByRole("option").map((o) => o.textContent)).toContain("Mexicali"),
      );
      expect(within(destino).queryByRole("option", { name: "Tijuana" })).toBeNull();
      await u.type((await screen.findAllByRole("textbox", { name: /piezas/i }))[0], "3");
      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
      await u.selectOptions(destino, "MX");
      vi.mocked(ops.crearOperacion).mockResolvedValue(op("n", "envio"));
      await u.click(screen.getByRole("button", { name: "Guardar" }));
      await waitFor(() =>
        expect(ops.crearOperacion).toHaveBeenCalledWith(expect.objectContaining({ tipo: "envio", destino: "MX" })),
      );
    });

    it("Merma pide un motivo de almacén", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      render(<PantallaRegistroOperacion sucursal={null} pestana="merma" />);
      await u.click(await screen.findByRole("button", { name: "Registrar merma" }));
      expect(motivosLib.listarMotivosMerma).toHaveBeenCalledWith("almacen");
      const motivo = await screen.findByLabelText("Motivo");
      await screen.findByRole("option", { name: "Caducado por fecha" });
      await u.type((await screen.findAllByRole("textbox", { name: /piezas/i }))[0], "3");
      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
      await u.selectOptions(motivo, "m1");
      vi.mocked(ops.crearOperacion).mockResolvedValue(op("n", "merma"));
      await u.click(screen.getByRole("button", { name: "Guardar" }));
      await waitFor(() =>
        expect(ops.crearOperacion).toHaveBeenCalledWith(expect.objectContaining({ tipo: "merma", motivoId: "m1" })),
      );
    });

    it("Descuento exige el trabajador", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      render(<PantallaRegistroOperacion sucursal={null} pestana="descuento" />);
      await u.click(await screen.findByRole("button", { name: "Registrar descuento" }));
      await u.type((await screen.findAllByRole("textbox", { name: /piezas/i }))[0], "3");
      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
      await u.type(screen.getByLabelText("Trabajador"), "  Pedro ");
      vi.mocked(ops.crearOperacion).mockResolvedValue(op("n", "descuento"));
      await u.click(screen.getByRole("button", { name: "Guardar" }));
      await waitFor(() =>
        expect(ops.crearOperacion).toHaveBeenCalledWith(expect.objectContaining({ trabajador: "Pedro" })),
      );
    });

    it("un error del servidor se muestra y no cierra la captura", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      vi.mocked(ops.crearOperacion).mockRejectedValue(new ErrorApi("x", 400, "Fecha fuera de regla"));
      render(<PantallaRegistroOperacion sucursal={null} pestana="consumo" />);
      await u.click(await screen.findByRole("button", { name: "Registrar consumo" }));
      await u.type((await screen.findAllByRole("textbox", { name: /piezas/i }))[0], "3");
      await u.click(screen.getByRole("button", { name: "Guardar" }));
      expect(await screen.findByText("Fecha fuera de regla")).toBeInTheDocument();
    });

    it("editar precarga y guarda con editarOperacion", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      vi.mocked(ops.listarOperaciones).mockResolvedValue(
        dia([op("o1", "merma", { motivo: { id: "m1", nombre: "Caducado por fecha" }, comentario: "Lote 4" })]),
      );
      vi.mocked(ops.editarOperacion).mockResolvedValue(op("o1", "merma"));
      render(<PantallaRegistroOperacion sucursal={null} pestana="merma" />);
      await u.click(await screen.findByRole("button", { name: "Editar" }));
      const campos = await screen.findAllByRole("textbox", { name: /piezas/i });
      expect(screen.getByLabelText("Piezas de Horchata 1 L")).toHaveValue("12");
      expect(campos.length).toBe(3);
      expect(screen.getByLabelText(/Comentario/)).toHaveValue("Lote 4");
      expect(await screen.findByLabelText("Motivo")).toHaveValue("m1");
      await u.clear(screen.getByLabelText("Piezas de Horchata 1 L"));
      await u.type(screen.getByLabelText("Piezas de Horchata 1 L"), "9");
      await u.click(screen.getByRole("button", { name: "Guardar" }));
      await waitFor(() =>
        expect(ops.editarOperacion).toHaveBeenCalledWith("o1", {
          fecha: HOY,
          motivoId: "m1",
          comentario: "Lote 4",
          lineas: [{ presentacionId: "p1", piezas: 9 }],
        }),
      );
    });

    it("un envío nuevo abre en hoy si la fecha de la pestaña es anterior a ayer", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
      const viejo = diaAnterior(diaAnterior(HOY));
      fireEvent.change(await screen.findByLabelText("Día"), { target: { value: viejo } });
      await waitFor(() => expect(ops.listarOperaciones).toHaveBeenLastCalledWith({ fecha: viejo, tipo: "entrada", sucursal: "TJ" }));
      await u.click(screen.getByRole("tab", { name: "Envíos" }));
      await u.click(await screen.findByRole("button", { name: "Registrar envío" }));
      expect(await screen.findByLabelText("Día")).toHaveValue(HOY);
    });

    it("un envío nuevo conserva ayer como fecha de la pestaña", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      render(<PantallaRegistroOperacion sucursal={null} pestana="envio" />);
      await u.click(await screen.findByRole("button", { name: "Ayer" }));
      await u.click(await screen.findByRole("button", { name: "Registrar envío" }));
      expect(await screen.findByLabelText("Día")).toHaveValue(diaAnterior(HOY));
    });

    it("si fallan los motivos o las sucursales lo dice", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      vi.mocked(motivosLib.listarMotivosMerma).mockRejectedValue(new ErrorApi("x", 500, "Motivos caídos"));
      vi.mocked(sucursalesLib.listarSucursales).mockRejectedValue(new ErrorApi("x", 500, "Sucursales caídas"));
      render(<PantallaRegistroOperacion sucursal={null} pestana="merma" />);
      await u.click(await screen.findByRole("button", { name: "Registrar merma" }));
      expect(await screen.findByText("Motivos caídos")).toBeInTheDocument();
      await u.click(screen.getByRole("button", { name: "← Volver a Merma" }));
      await u.click(screen.getByRole("tab", { name: "Envíos" }));
      await u.click(await screen.findByRole("button", { name: "Registrar envío" }));
      expect(await screen.findByText("Sucursales caídas")).toBeInTheDocument();
    });

    it("Volver regresa a la lista sin guardar", async () => {
      mockAuth(TODOS);
      const u = userEvent.setup();
      render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
      await u.click(await screen.findByRole("button", { name: "Registrar entrada" }));
      await u.click(await screen.findByRole("button", { name: "← Volver a Entradas/Compras" }));
      expect(await screen.findByRole("button", { name: "Registrar entrada" })).toBeInTheDocument();
      expect(ops.crearOperacion).not.toHaveBeenCalled();
    });
  });

  it("eliminar confirma y da de baja", async () => {
    mockAuth(TODOS);
    const u = userEvent.setup();
    vi.mocked(ops.listarOperaciones).mockResolvedValue(dia([op("o1", "consumo")]));
    vi.mocked(ops.eliminarOperacion).mockResolvedValue(undefined);
    render(<PantallaRegistroOperacion sucursal={null} pestana="consumo" />);
    await u.click(await screen.findByRole("button", { name: "Eliminar" }));
    expect(ops.eliminarOperacion).not.toHaveBeenCalled();
    await u.click(await screen.findByRole("button", { name: "Eliminar registro" }));
    await waitFor(() => expect(ops.eliminarOperacion).toHaveBeenCalledWith("o1"));
    await waitFor(() => expect(ops.listarOperaciones).toHaveBeenCalledTimes(2));
  });
});
