import { PantallaPendiente } from '@/ui/pantalla-pendiente';

export default function Venta() {
  return (
    <PantallaPendiente
      titulo="Venta"
      ticket="T-16"
      descripcion="El vendedor solo captura cantidades; el total sale de cantidad × precio del cliente. Las notas físicas de crédito se siguen firmando en papel."
    />
  );
}
