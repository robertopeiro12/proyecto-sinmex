import { PantallaPendiente } from '@/ui/pantalla-pendiente';

export default function VisitaSinVenta() {
  return (
    <PantallaPendiente
      titulo="Visita sin venta"
      ticket="T-33"
      descripcion="Motivo por el que el cliente no se surtio (tenia producto, sin dinero, no estaba el encargado, competencia, cerrado), con hora y quien atendio."
    />
  );
}
