// apps/portal/src/lib/excel/exportar.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as construir from "./construir-libro";
import { exportarExcel } from "./exportar";
import type { DefinicionExcel } from "./definicion";

vi.mock("./construir-libro", () => ({ construirLibro: vi.fn(), cargarExcelJS: vi.fn() }));

const DEF: DefinicionExcel = {
  titulo: "T",
  filtros: [],
  columnas: [{ encabezado: "A", tipo: "texto" }],
  filas: [],
  nombreArchivo: "kilometraje_2026-10-01_a_2026-10-13",
};

describe("exportarExcel", () => {
  const crear = vi.fn<(obj: Blob | MediaSource) => string>(() => "blob:prueba");
  const revocar = vi.fn();

  beforeEach(() => {
    vi.mocked(construir.construirLibro).mockResolvedValue(new ArrayBuffer(4));
    // jsdom no implementa createObjectURL.
    Object.defineProperty(URL, "createObjectURL", { value: crear, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revocar, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("descarga el libro con el nombre .xlsx y libera la URL", async () => {
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("kilometraje_2026-10-01_a_2026-10-13.xlsx");
      expect(this.href).toBe("blob:prueba");
    });

    await exportarExcel(DEF);

    expect(construir.construirLibro).toHaveBeenCalledWith(DEF);
    expect(clic).toHaveBeenCalledTimes(1);
    const blob = crear.mock.calls[0]?.[0] as unknown as Blob;
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(revocar).toHaveBeenCalledWith("blob:prueba");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
