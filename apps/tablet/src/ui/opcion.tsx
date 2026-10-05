import { Pressable, Text } from 'react-native';

import { useTema } from './tema';
import { colores, grosor } from './tokens';

/**
 * Una opcion de un grupo (contado/credito, factura, metodo de pago).
 *
 * No es un `<Boton>`: elegir no hace nada todavia, solo marca. La seleccion se
 * distingue por tres canales a la vez (borde, fondo y la palabra
 * "Seleccionado"), igual que el vehiculo en `abrir-dia.tsx`.
 *
 * Nacio dentro de `venta.tsx` (T-16); T-20 la necesito en la cobranza y la
 * movio aqui para que las dos pantallas marquen igual.
 */
export function Opcion({
  etiqueta,
  seleccionada,
  onPress,
}: {
  etiqueta: string;
  seleccionada: boolean;
  onPress: () => void;
}) {
  const { estilos } = useTema();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: seleccionada }}
      accessibilityLabel={etiqueta}
      onPress={onPress}
      style={({ pressed }) => [
        estilos.tarjeta,
        estilos.celdaRejilla,
        {
          borderWidth: grosor.fuerte,
          borderColor: seleccionada ? colores.primario : colores.borde,
        },
        seleccionada && { backgroundColor: colores.primarioTenue },
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
      ]}
    >
      <Text style={estilos.textoTarjeta}>{etiqueta}</Text>
      {seleccionada ? <Text style={estilos.textoSuave}>Seleccionado</Text> : null}
    </Pressable>
  );
}
