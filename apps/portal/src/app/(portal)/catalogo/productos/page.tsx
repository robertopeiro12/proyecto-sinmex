import { PantallaProductos } from "@/components/productos/pantalla-productos";

// A diferencia de la de Sucursales, esta pagina NO lee `searchParams`: el
// catalogo de sabores es de la empresa y el selector "Por sucursal" de la
// barra lateral no le aplica (D4). No es un olvido.
export default function Page() {
  return <PantallaProductos />;
}
