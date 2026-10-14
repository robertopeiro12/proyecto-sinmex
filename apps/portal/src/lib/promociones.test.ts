import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  crearPromocion,
  editarPromocion,
  listarPromociones,
  nombresDe,
  problemaDeRegla,
  textoPromocion,
  type DatosPromocion,
  type ReglaCompleta,
} from "./promociones";
import type { Producto } from "./productos";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

describe("lib/promociones: API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue([]);
  });

  it("listarPromociones pide por sucursal o por cliente", async () => {
    await listarPromociones({ sucursal: "TJ" });
    expect(apiFetch).toHaveBeenLastCalledWith("/promociones?sucursal=TJ");
    await listarPromociones({ clienteId: "c1" });
    expect(apiFetch).toHaveBeenLastCalledWith("/promociones?clienteId=c1");
    await listarPromociones({ sucursal: null });
    expect(apiFetch).toHaveBeenLastCalledWith("/promociones");
  });

  it("crearPromocion hace POST con el cuerpo tal cual", async () => {
    const datos: DatosPromocion = {
      sucursalId: "s1",
      audiencia: "todos",
      compraTipo: "producto",
      compraProductoId: "p1",
      compraCantidad: 10,
      regaloTipo: "mismo",
      regaloCantidad: 1,
      seRepite: true,
    };
    await crearPromocion(datos);
    expect(apiFetch).toHaveBeenLastCalledWith("/promociones", {
      method: "POST",
      body: JSON.stringify(datos),
    });
  });

  it("editarPromocion hace PATCH por id con la regla y activo", async () => {
    const datos = {
      compraTipo: "cualquiera" as const,
      compraCantidad: 20,
      regaloTipo: "presentacion" as const,
      regaloPresentacionId: "pr1",
      regaloCantidad: 1,
      seRepite: true,
      activo: false,
    };
    await editarPromocion("pr-9", datos);
    expect(apiFetch).toHaveBeenLastCalledWith("/promociones/pr-9", {
      method: "PATCH",
      body: JSON.stringify(datos),
    });
  });
});

describe("textoPromocion (T-74)", () => {
  it("por cada N de un producto, M del mismo, se repite", () => {
    expect(
      textoPromocion(
        {
          audiencia: "todos",
          compraTipo: "producto",
          compraCantidad: 10,
          regaloTipo: "mismo",
          regaloCantidad: 1,
          seRepite: true,
        },
        { compra: "Jawa", regalo: null },
      ),
    ).toBe("Por cada 10 Jawa, 1 Jawa gratis");
  });

  it("al comprar N de una presentacion, M de la misma, una vez", () => {
    expect(
      textoPromocion(
        {
          audiencia: "cliente",
          compraTipo: "presentacion",
          compraCantidad: 10,
          regaloTipo: "mismo",
          regaloCantidad: 1,
          seRepite: false,
        },
        { compra: "Jawa 600 ml", regalo: null },
      ),
    ).toBe("Al comprar 10 Jawa 600 ml, 1 Jawa 600 ml gratis (una vez)");
  });

  it("por cada N piezas de lo que sea, M de una presentacion", () => {
    expect(
      textoPromocion(
        {
          audiencia: "todos",
          compraTipo: "cualquiera",
          compraCantidad: 20,
          regaloTipo: "presentacion",
          regaloCantidad: 1,
          seRepite: true,
        },
        { compra: null, regalo: "Jawa 1 L" },
      ),
    ).toBe("Por cada 20 piezas de lo que sea, 1 Jawa 1 L gratis");
  });

  it("por cada pieza (singular), M de un producto", () => {
    expect(
      textoPromocion(
        {
          audiencia: "todos",
          compraTipo: "cualquiera",
          compraCantidad: 1,
          regaloTipo: "producto",
          regaloCantidad: 1,
          seRepite: true,
        },
        { compra: null, regalo: "Horchata" },
      ),
    ).toBe("Por cada pieza, 1 Horchata gratis");
  });

  it("bienvenida al prospecto sin compra", () => {
    expect(
      textoPromocion(
        {
          audiencia: "prospecto",
          compraTipo: "cualquiera",
          compraCantidad: 0,
          regaloTipo: "presentacion",
          regaloCantidad: 2,
          seRepite: false,
        },
        { compra: null, regalo: "Jawa 600 ml" },
      ),
    ).toBe("Bienvenida al prospecto: 2 Jawa 600 ml gratis en su primera venta");
  });

  it("bienvenida al prospecto con compra", () => {
    expect(
      textoPromocion(
        {
          audiencia: "prospecto",
          compraTipo: "producto",
          compraCantidad: 5,
          regaloTipo: "mismo",
          regaloCantidad: 1,
          seRepite: false,
        },
        { compra: "Jawa", regalo: null },
      ),
    ).toBe("Bienvenida al prospecto: al comprar 5 Jawa, 1 Jawa gratis en su primera venta");
  });

  it("sin nombre resuelto no revienta: deja un hueco visible", () => {
    expect(
      textoPromocion(
        {
          audiencia: "todos",
          compraTipo: "producto",
          compraCantidad: 10,
          regaloTipo: "mismo",
          regaloCantidad: 1,
          seRepite: true,
        },
        { compra: null, regalo: null },
      ),
    ).toBe("Por cada 10 (producto), 1 (producto) gratis");
  });
});

const base: ReglaCompleta = {
  audiencia: "todos",
  clienteId: null,
  compraTipo: "producto",
  compraProductoId: "p1",
  compraPresentacionId: null,
  compraCantidad: 10,
  regaloTipo: "mismo",
  regaloProductoId: null,
  regaloPresentacionId: null,
  regaloCantidad: 1,
  seRepite: true,
};

describe("problemaDeRegla (T-74)", () => {
  it("una regla bien formada no tiene problema", () => {
    expect(problemaDeRegla(base)).toBeNull();
  });
  it("del mismo no cabe con cualquier producto", () => {
    expect(problemaDeRegla({ ...base, compraTipo: "cualquiera", compraProductoId: null })).toBe(
      "Si la compra es de cualquier producto, el regalo tiene que ser un producto o una presentación concretos.",
    );
  });
  it("compra por producto exige el producto y no la presentacion", () => {
    expect(problemaDeRegla({ ...base, compraProductoId: null })).toBe("Elige el producto que se compra.");
    expect(problemaDeRegla({ ...base, compraPresentacionId: "x" })).toBe("Elige el producto que se compra.");
  });
  it("compra por presentacion exige la presentacion", () => {
    expect(
      problemaDeRegla({ ...base, compraTipo: "presentacion", compraProductoId: null }),
    ).toBe("Elige la presentación que se compra.");
  });
  it("regalo por producto / presentacion exige su id", () => {
    expect(problemaDeRegla({ ...base, regaloTipo: "producto" })).toBe("Elige el producto que se regala.");
    expect(problemaDeRegla({ ...base, regaloTipo: "presentacion" })).toBe(
      "Elige la presentación que se regala.",
    );
  });
  it("comprar 0 solo vale para prospectos", () => {
    expect(problemaDeRegla({ ...base, compraCantidad: 0 })).toBe(
      "La cantidad de compra debe ser al menos 1; solo la promoción de prospectos puede regalar sin compra.",
    );
    expect(
      problemaDeRegla({
        ...base,
        audiencia: "prospecto",
        seRepite: false,
        compraCantidad: 0,
        compraTipo: "cualquiera",
        compraProductoId: null,
        regaloTipo: "producto",
        regaloProductoId: "p2",
      }),
    ).toBeNull();
  });
  it("se regala al menos una pieza, enteras", () => {
    expect(problemaDeRegla({ ...base, regaloCantidad: 0 })).toBe("Se regala al menos 1 pieza.");
    expect(problemaDeRegla({ ...base, regaloCantidad: 1.5 })).toBe("Se regala al menos 1 pieza.");
  });
  it("la de prospectos no se repite por bloques", () => {
    expect(
      problemaDeRegla({ ...base, audiencia: "prospecto", seRepite: true }),
    ).toBe("La promoción de prospectos se da una sola vez, en su primera venta.");
    expect(
      problemaDeRegla({ ...base, audiencia: "prospecto", seRepite: false }),
    ).toBeNull();
  });
  it("audiencia cliente exige el cliente, y las demas no lo admiten", () => {
    expect(problemaDeRegla({ ...base, audiencia: "cliente" })).toBe("Elige el cliente de la promoción.");
    expect(problemaDeRegla({ ...base, clienteId: "c1" })).toBe(
      "Solo una promoción de un cliente lleva cliente.",
    );
  });
});

describe("nombresDe (T-74)", () => {
  const productos: Producto[] = [
    { id: "p1", nombre: "Jawa", activo: true, presentaciones: [{ id: "pr1", volumen: "600 ml" }] },
  ];

  it("compra por producto da el nombre del producto", () => {
    expect(
      nombresDe({ compraTipo: "producto", compraProductoId: "p1", regaloTipo: "mismo" }, productos),
    ).toEqual({ compra: "Jawa", regalo: null });
  });
  it("compra por presentacion da producto y volumen", () => {
    expect(
      nombresDe(
        { compraTipo: "presentacion", compraPresentacionId: "pr1", regaloTipo: "mismo" },
        productos,
      ),
    ).toEqual({ compra: "Jawa 600 ml", regalo: null });
  });
  it("regalo mismo no tiene nombre propio y cualquiera tampoco", () => {
    expect(
      nombresDe({ compraTipo: "cualquiera", regaloTipo: "mismo" }, productos),
    ).toEqual({ compra: null, regalo: null });
  });
  it("ids desconocidos dan null", () => {
    expect(
      nombresDe(
        {
          compraTipo: "producto",
          compraProductoId: "x",
          regaloTipo: "presentacion",
          regaloPresentacionId: "y",
        },
        productos,
      ),
    ).toEqual({ compra: null, regalo: null });
  });
});
