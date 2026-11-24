import { PantallaPendiente } from '@/ui/pantalla-pendiente';
import { MarcoMenu } from '@/ui/marco-menu';

export default function SugeridoDeCarga() {
  return (
    <MarcoMenu clave="sugerido" titulo="Sugerido de carga">
      <PantallaPendiente titulo="Sugerido de carga" ticket="una pieza posterior del rediseño" descripcion="Lo que conviene cargar según tu ruta." />
    </MarcoMenu>
  );
}
