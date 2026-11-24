import { PantallaPendiente } from '@/ui/pantalla-pendiente';
import { MarcoMenu } from '@/ui/marco-menu';

export default function Impresora() {
  return (
    <MarcoMenu titulo="Seleccionar impresora">
      <PantallaPendiente titulo="Seleccionar impresora" ticket="una pieza posterior del rediseño" descripcion="Elegir la impresora de notas." />
    </MarcoMenu>
  );
}
