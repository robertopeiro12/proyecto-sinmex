import { ScrollView, Text, View } from 'react-native';

import { estilos } from './tema';

/**
 * Pantalla marcador de posicion.
 *
 * Mismo patron que `Placeholder` del portal en T-03: la navegacion es real, el
 * contenido llega en el ticket que le toca. Se muestra el ticket para que quede
 * claro donde vive cada modulo.
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
  return (
    <ScrollView style={estilos.pantalla}>
      <Text style={estilos.titulo}>{titulo}</Text>
      <Text style={estilos.subtitulo}>{descripcion}</Text>
      <View style={estilos.tarjeta}>
        <Text style={estilos.etiqueta}>Proximamente</Text>
        <Text style={estilos.textoTarjeta}>Se implementa en {ticket}</Text>
        <Text style={estilos.textoSuave}>
          T-04 solo deja la navegacion y el almacenamiento local; la logica de este modulo es su
          propio ticket.
        </Text>
      </View>
    </ScrollView>
  );
}
