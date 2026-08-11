import { PantallaPendiente } from '@/ui/pantalla-pendiente';

export default function RegistrosDeCampo() {
  return (
    <PantallaPendiente
      titulo="Merma, promocion, consumo y gasto"
      ticket="T-22"
      descripcion="Registros que afectan el inventario y el corte. La promocion entrega producto a $0 y el consumo propio se registra antes de enviar el sobrante."
    />
  );
}
