export type NavItem = { label: string; href: string };
export type NavSection = { label: string; items: NavItem[] };

export const navSections: NavSection[] = [
  {
    label: "Operación",
    items: [
      { label: "Dashboard", href: "/operacion" },
      { label: "Reporte de Ventas", href: "/operacion/reporte-de-ventas" },
      { label: "Procesos", href: "/operacion/procesos" },
      { label: "Peticiones", href: "/operacion/peticiones" },
      { label: "Notificaciones", href: "/operacion/notificaciones" },
      { label: "Ruta Diaria", href: "/operacion/ruta-diaria" },
      { label: "Ruta Semanal", href: "/operacion/ruta-semanal" },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { label: "Clientes", href: "/catalogo/clientes" },
      { label: "Vendedores", href: "/catalogo/vendedores" },
      { label: "Vehículos", href: "/catalogo/vehiculos" },
      { label: "Productos", href: "/catalogo/productos" },
      { label: "Usuarios", href: "/catalogo/usuarios" },
      { label: "Perfiles y Permisos", href: "/catalogo/perfiles-y-permisos" },
    ],
  },
  {
    label: "Producción",
    items: [
      { label: "Peticiones", href: "/produccion/peticiones" },
      { label: "Recarga", href: "/produccion/recarga" },
      { label: "Corte", href: "/produccion/corte" },
      { label: "Almacenes", href: "/produccion/almacenes" },
    ],
  },
  {
    label: "Información",
    items: [
      { label: "Reportes", href: "/informacion/reportes" },
      { label: "Análisis Cliente", href: "/informacion/analisis-cliente" },
      { label: "Nómina", href: "/informacion/nomina" },
    ],
  },
];
