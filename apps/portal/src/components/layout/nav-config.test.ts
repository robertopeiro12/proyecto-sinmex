import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buscarItemActual, navSections, tituloDePestana } from "./nav-config";

// Sin `new URL(relativa, import.meta.url)`: en el entorno jsdom, `URL` es la de jsdom y
// resuelve contra http://localhost.
const PAGINAS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "(portal)");

describe("navSections", () => {
  it("en el orden del spec", () => {
    expect(navSections.map((s) => s.label)).toEqual(["Operación", "Finanzas", "Producción", "Información", "Catálogo"]);
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
