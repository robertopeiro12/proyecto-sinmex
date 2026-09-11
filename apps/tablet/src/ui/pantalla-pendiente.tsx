import { Text } from 'react-native';

import { Pantalla, Tarjeta } from './pantalla';
import { useTema } from './tema';

/**
 * Pantalla marcador de posicion.
 *
 * Mismo patron que `Placeholder` del portal en T-03: la navegacion es real, el
 * contenido llega en el ticket que le toca. Se muestra el ticket para que quede
 * claro donde vive cada modulo.
 *
 * La tarjeta va en estado `pendiente` (ambar, con barra de acento) y no en
 * neutro: es lo mismo que dice la pastilla de "falta subir" en la jornada —
 * *aqui hay algo sin terminar*. Un vendedor no deberia llegar nunca a estas
 * pantallas en produccion, pero mientras la app se entrega por partes, que se
 * distinga de un vistazo de una pantalla que si funciona ahorra un reporte de
 * bug.
 */
export function PantallaPendiente({
  titulo,
  ticket,
  descripcion,
}: {
  titulo: string;
  ticket: string;
  descripcion: string;
}) {
  const { estilos } = useTema();

  return (
    <Pantalla titulo={titulo} subtitulo={descripcion}>
      <Tarjeta estado="pendiente" etiqueta="Próximamente">
        <Text style={estilos.textoTarjeta}>Se implementa en {ticket}</Text>
        <Text style={estilos.textoSuave}>
          T-04 solo dejó la navegación y el almacenamiento local; la lógica de este módulo es su
          propio ticket.
        </Text>
      </Tarjeta>
    </Pantalla>
  );
}
