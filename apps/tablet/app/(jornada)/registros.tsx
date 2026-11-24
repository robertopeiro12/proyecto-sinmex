import { PantallaPendiente } from '@/ui/pantalla-pendiente';
import { MarcoMenu } from '@/ui/marco-menu';

export default function Registros() {
  return (
    <MarcoMenu titulo="Ventas / Cobranza">
      <PantallaPendiente titulo="Ventas / Cobranza" ticket="una pieza posterior del rediseño" descripcion="Tus ventas y cobranza del día." />
    </MarcoMenu>
  );
}
