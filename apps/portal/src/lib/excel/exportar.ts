// apps/portal/src/lib/excel/exportar.ts
import { construirLibro } from "./construir-libro";
import type { DefinicionExcel } from "./definicion";

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Arma el libro y lo descarga como `<nombreArchivo>.xlsx`. */
export async function exportarExcel(def: DefinicionExcel): Promise<void> {
  const datos = await construirLibro(def);
  const url = URL.createObjectURL(new Blob([datos], { type: TIPO_XLSX }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `${def.nombreArchivo}.xlsx`;
  document.body.appendChild(enlace);
  try {
    enlace.click();
  } finally {
    enlace.remove();
    URL.revokeObjectURL(url);
  }
}
