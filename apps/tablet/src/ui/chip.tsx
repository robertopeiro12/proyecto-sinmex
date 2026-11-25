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
  envolver = false,
}: {
  etiqueta: string;
  elegida: boolean;
  onPress: () => void;
  /** Reparte el ancho de la fila entre las opciones. */
  ancho?: boolean;
  /**
   * Mide lo que pide su texto y crece con lo que sobre; la fila que lo contiene
   * debe llevar `flexWrap: 'wrap'`. Para etiquetas largas en celular (filtros de
   * Ventas / Cobranza): si no caben en una fila se apilan en vez de partir
   * palabras (recorrido final, D3).
   */
  envolver?: boolean;
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
        envolver && { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' },
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
      ]}
    >
      <Text
        style={{
          textAlign: 'center',
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
