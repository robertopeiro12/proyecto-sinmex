import { Pressable, Text } from 'react-native';

import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Una opcion corta en tira (presentacion de la promocion, Liquidar / Abonar,
 * metodo de pago). Se usa en la venta y en Cobrar.
 */
export function Chip({
  etiqueta,
  elegida,
  onPress,
  ancho = false,
}: {
  etiqueta: string;
  elegida: boolean;
  onPress: () => void;
  /** Reparte el ancho de la fila entre las opciones. */
  ancho?: boolean;
}) {
  const { dispositivo, t } = useTema();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: elegida }}
      accessibilityLabel={etiqueta}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: Math.min(dispositivo.tactil, 48),
          paddingHorizontal: espacio.md,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radio.chico,
          borderWidth: grosor.fuerte,
          borderColor: elegida ? colores.primario : colores.borde,
          backgroundColor: elegida ? colores.primarioTenue : colores.superficie,
        },
        ancho && { flex: 1 },
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
      ]}
    >
      <Text
        style={{
          fontFamily: fuente.cuerpoFuerte,
          fontSize: t(tipo.cuerpo),
          color: elegida ? colores.primario : colores.tinta,
        }}
      >
        {etiqueta}
      </Text>
    </Pressable>
  );
}
