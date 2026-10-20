"use client";

import { FileSpreadsheet } from "lucide-react";
import { Button } from "./button";

/** El botón de Excel de todo reporte (UI Etapa 1, spec §4.3). La pantalla hace la exportación. */
export function BotonExcel({
  exportando,
  disabled = false,
  onClick,
}: {
  exportando: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="outline" disabled={disabled || exportando} onClick={onClick}>
      <FileSpreadsheet aria-hidden />
      {exportando ? "Exportando…" : "Exportar a Excel"}
    </Button>
  );
}
