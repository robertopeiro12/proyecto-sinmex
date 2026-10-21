import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Monto } from "./monto";

/*
 * La tabla común (UI Etapa 1, spec §4.2), con el estilo de Reporte de Ventas y
 * Tesorería: encabezados en gris sobre el color del menú, filas separadas por línea.
 */

type Alineacion = "izquierda" | "derecha" | "centro";

const ALINEAR: Record<Alineacion, string> = {
  izquierda: "text-left",
  derecha: "text-right",
  centro: "text-center",
};

/**
 * La caja: borde, esquinas de 10 px y su propio desplazamiento. Una tabla ancha se
 * desplaza aquí dentro y la página no (el `main` del marco lleva `min-w-0`). Con
 * `altoMaximo` también se desplaza hacia abajo dentro de la caja y el encabezado queda fijo.
 */
export function CajaTabla({ altoMaximo, className, style, ...props }: ComponentProps<"div"> & { altoMaximo?: string }) {
  return (
    <div
      {...props}
      className={cn("overflow-auto rounded-[10px] border", className)}
      style={altoMaximo ? { ...style, maxHeight: altoMaximo } : style}
    />
  );
}

export function Tabla({
  densidad = "normal",
  className,
  ...props
}: ComponentProps<"table"> & { densidad?: "normal" | "compacta" }) {
  return (
    <table
      {...props}
      data-densidad={densidad}
      className={cn("group/tabla w-full border-collapse text-sm tabular-nums", className)}
    />
  );
}

export function Th({ alinear = "izquierda", scope = "col", className, ...props }: ComponentProps<"th"> & { alinear?: Alineacion }) {
  return (
    <th
      {...props}
      scope={scope}
      className={cn(
        "sticky top-0 z-[1] border-b bg-menu shadow-[inset_0_-1px_0_var(--border)] px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap text-muted-foreground group-data-[densidad=compacta]/tabla:py-1.5",
        ALINEAR[alinear],
        className,
      )}
    />
  );
}

export function Td({ alinear = "izquierda", className, ...props }: ComponentProps<"td"> & { alinear?: Alineacion }) {
  return (
    <td
      {...props}
      className={cn("border-b px-3 py-2 group-data-[densidad=compacta]/tabla:py-1", ALINEAR[alinear], className)}
    />
  );
}

/** Un monto: a la derecha, cifras de ancho fijo y sin cortarse en dos renglones. */
export function TdMonto({ centavos, className, ...props }: Omit<ComponentProps<"td">, "children"> & { centavos: number }) {
  return (
    <Td {...props} alinear="derecha" className={cn("whitespace-nowrap", className)}>
      <Monto centavos={centavos} />
    </Td>
  );
}

/** `interactiva`: la fila se puede picar y lleva un tono suave al pasar el mouse. */
export function Fila({ interactiva = false, className, ...props }: ComponentProps<"tr"> & { interactiva?: boolean }) {
  return <tr {...props} className={cn(interactiva && "cursor-pointer transition-colors hover:bg-menu", className)} />;
}

export function FilaVacia({ columnas, children }: { columnas: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={columnas} className="px-3 py-6 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

/** El encabezado de un grupo (un vehículo, un día): ocupa todo el ancho. */
export function FilaGrupo({ columnas, children }: { columnas: number; children: ReactNode }) {
  return (
    <tr>
      <th colSpan={columnas} scope="rowgroup" className="border-b bg-menu px-3 py-2 text-left font-semibold">
        {children}
      </th>
    </tr>
  );
}

export function FilaTotal({ className, ...props }: ComponentProps<"tr">) {
  return <tr {...props} className={cn("font-semibold [&>td]:border-t-2 [&>td]:border-b-0", className)} />;
}
