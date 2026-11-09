import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buscarItemActual, navSections, tituloDePestana } from "./nav-config";

// Sin `new URL(relativa, import.meta.url)`: en el entorno jsdom, `URL` es la de jsdom y
// resuelve contra http://localhost.
const PAGINAS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "(portal)");

describe("navSections", () => {
  it("en el orden del sistema viejo, y lo nuevo después", () => {
    expect(navSections.map((s) => s.label)).toEqual(["Operación", "Catálogo", "Producción", "Información", "Finanzas"]);
    const operacion = navSections[0].items.map((i) => i.label);
    expect(operacion.slice(0, 7)).toEqual([
      "Dashboard",
      "Flujo diario",
      "Peticiones",
      "Procesos",
      "Notificaciones",
      "Ruta Diaria",
      "Ruta Semanal",
    ]);
    expect(navSections[1].items.slice(0, 3).map((i) => i.label)).toEqual(["Clientes", "Vendedores", "Vehículos"]);
    expect(navSections[2].items.slice(0, 3).map((i) => i.label)).toEqual(["Peticiones", "Recarga", "Corte"]);
  });

  it("toda pantalla que todavía es Placeholder lleva pronto, y ninguna otra", () => {
    for (const seccion of navSections) {
      for (const item of seccion.items) {
        const pagina = readFileSync(join(PAGINAS, ...item.href.split("/").filter(Boolean), "page.tsx"), "utf8");
        expect({ href: item.href, pronto: item.pronto === true }).toEqual({
          href: item.href,
          pronto: pagina.includes("Placeholder"),
        });
      }
    }
  });
});

describe("buscarItemActual", () => {
  it("la opción exacta", () => {
    expect(buscarItemActual("/operacion/ventas")).toEqual({
      seccion: "Operación",
      item: { label: "Ventas", href: "/operacion/ventas" },
    });
  });

  it("una pantalla dentro de otra es la de href más largo, por segmentos completos", () => {
    expect(buscarItemActual("/informacion/reportes/kilometraje")?.item.label).toBe("Reportes");
    expect(buscarItemActual("/operacion")?.item.label).toBe("Dashboard");
    expect(buscarItemActual("/operacion/ventas/algo")?.item.label).toBe("Ventas");
    expect(buscarItemActual("/operacionx")).toBeNull();
    expect(buscarItemActual("/operacion/reporte-de-ventas")?.item.label).toBe("Flujo diario");
    expect(buscarItemActual("/login")).toBeNull();
  });
});

describe("tituloDePestana", () => {
  it("pantalla | JAWA y la sucursal; con todas, sin sucursal", () => {
    expect(tituloDePestana("/operacion/ventas", "Tijuana")).toBe("Ventas | JAWA Tijuana");
    expect(tituloDePestana("/operacion/ventas", null)).toBe("Ventas | JAWA");
    expect(tituloDePestana("/informacion/reportes/kilometraje", "Mexicali")).toBe("Reportes | JAWA Mexicali");
  });

  it("una dirección fuera del menú dice solo JAWA", () => {
    expect(tituloDePestana("/desconocida", "Tijuana")).toBe("JAWA Tijuana");
    expect(tituloDePestana("/desconocida", null)).toBe("JAWA");
  });
});
