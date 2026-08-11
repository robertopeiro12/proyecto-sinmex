import { PantallaPendiente } from '@/ui/pantalla-pendiente';

export default function Prospectos() {
  return (
    <PantallaPendiente
      titulo="Prospectos"
      ticket="T-24"
      descripcion="El vendedor ya no da de alta clientes (eso lo hace el administrador en el portal), pero si prospectos, y puede obsequiarles piezas. La foto se incluye solo si no ralentiza el alta."
    />
  );
}
