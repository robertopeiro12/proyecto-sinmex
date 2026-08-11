import { PantallaPendiente } from '@/ui/pantalla-pendiente';

export default function Cobranza() {
  return (
    <PantallaPendiente
      titulo="Cobranza / abono"
      ticket="T-20"
      descripcion="Se muestran las notas pendientes del cliente y se seleccionan las que paga o abona."
    />
  );
}
