export type NavItem = {
  label: string;
  href: string;
  /** La pantalla todavía es un "Próximamente" (`Placeholder`): el menú la marca "Pronto". */
  pronto?: true;
};
export type NavSection = { label: string; items: NavItem[] };

// Orden del spec (UI Etapa 1, §3.3). Una pantalla nueva se agrega aquí; mientras su
// page.tsx sea un Placeholder lleva `pronto: true` (nav-config.test.ts lo exige).
export const navSections: NavSection[] = [
  {
    label: "Operación",
    items: [
      { label: "Dashboard", href: "/operacion", pronto: true },
      { label: "Registrar venta", href: "/operacion/registrar-venta" },
      { label: "Ventas", href: "/operacion/ventas" },
      { label: "Facturas", href: "/operacion/facturas" },
      { label: "Cobranza", href: "/operacion/cobranza" },
      { label: "Cuentas por Cobrar", href: "/operacion/cuentas-por-cobrar" },
      { label: "Reporte de Ventas", href: "/operacion/reporte-de-ventas" },
      { label: "Promociones", href: "/operacion/promociones" },
      { label: "Procesos", href: "/operacion/procesos", pronto: true },
      { label: "Peticiones", href: "/operacion/peticiones" },
      { label: "Notificaciones", href: "/operacion/notificaciones", pronto: true },
      { label: "Ruta Diaria", href: "/operacion/ruta-diaria" },
      { label: "Ruta Semanal", href: "/operacion/ruta-semanal", pronto: true },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { label: "Tesorería", href: "/finanzas/tesoreria" },
      { label: "Gastos", href: "/finanzas/gastos" },
      { label: "Flujo de Efectivo", href: "/finanzas/flujo-efectivo" },
    ],
  },
  {
    label: "Producción",
    items: [
      { label: "Peticiones", href: "/produccion/peticiones", pronto: true },
      { label: "Recarga", href: "/produccion/recarga" },
      { label: "Corte", href: "/produccion/corte", pronto: true },
      { label: "Almacenes", href: "/produccion/almacenes", pronto: true },
    ],
  },
  {
    label: "Información",
    items: [
      { label: "Reportes", href: "/informacion/reportes" },
      { label: "Análisis Cliente", href: "/informacion/analisis-cliente", pronto: true },
      { label: "Nómina", href: "/informacion/nomina", pronto: true },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { label: "Sucursales", href: "/catalogo/sucursales" },
      { label: "Clientes", href: "/catalogo/clientes" },
      { label: "Vendedores", href: "/catalogo/vendedores" },
      { label: "Vehículos", href: "/catalogo/vehiculos" },
      { label: "Motivos de visita", href: "/catalogo/motivos-de-visita" },
      { label: "Campos de egreso", href: "/catalogo/campos-de-egreso" },
      { label: "Productos", href: "/catalogo/productos" },
      { label: "Listas de Precios", href: "/catalogo/precios" },
      { label: "Usuarios", href: "/catalogo/usuarios" },
      { label: "Perfiles y Permisos", href: "/catalogo/perfiles-y-permisos" },
    ],
  },
];

export interface ItemActual {
  seccion: string;
  item: NavItem;
}

/**
 * La opción del menú de esta dirección: la de `href` más largo que la contenga por
 * segmentos completos. `/informacion/reportes/kilometraje` es "Reportes";
 * `/operacion/ventas` no es "Dashboard" (`/operacion`).
 */
export function buscarItemActual(pathname: string): ItemActual | null {
  let mejor: ItemActual | null = null;
  for (const seccion of navSections) {
    for (const item of seccion.items) {
      const coincide = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (coincide && (mejor === null || item.href.length > mejor.item.href.length)) {
        mejor = { seccion: seccion.label, item };
      }
    }
  }
  return mejor;
}

/** "Ventas | JAWA Tijuana"; con todas las sucursales, "Ventas | JAWA" (spec §3.2). */
export function tituloDePestana(pathname: string, sucursal: string | null): string {
  const marca = sucursal ? `JAWA ${sucursal}` : "JAWA";
  const actual = buscarItemActual(pathname);
  return actual ? `${actual.item.label} | ${marca}` : marca;
}
