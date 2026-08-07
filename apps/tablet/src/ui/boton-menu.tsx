import { Link, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { estilos } from './tema';

/** Tarjeta grande de navegacion, dimensionada para tocarse con el dedo. */
export function BotonMenu({
  titulo,
  descripcion,
  destino,
}: {
  titulo: string;
  descripcion: string;
  destino: Href;
}) {
  return (
    <Link href={destino} asChild>
      <Pressable style={({ pressed }) => [
        estilos.tarjeta,
        estilos.celdaRejilla,
        pressed && { opacity: 0.6 },
      ]}>
        <View>
          <Text style={estilos.textoTarjeta}>{titulo}</Text>
          <Text style={estilos.textoSuave}>{descripcion}</Text>
        </View>
      </Pressable>
    </Link>
  );
}
