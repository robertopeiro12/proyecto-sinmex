import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icono } from './icono';
import { colores, espacio, grosor, radio } from './tokens';

/**
 * El checklist de la tablet (la casilla `chk` de las maquetas): un renglon
 * tocable con borde y la casilla con palomita SVG. Lo usan la venta
 * (promociones y lista) y la carga del Inventario (pieza 3).
 */

/** Un renglon tocable de la lista o del checklist. */
export function Renglon({
  children,
  onPress,
  etiqueta,
  borde,
  fondo = colores.superficie,
  estadoA11y,
}: {
  children: ReactNode;
  onPress: () => void;
  etiqueta: string;
  borde: string;
  fondo?: string;
  estadoA11y?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={estadoA11y === undefined ? 'button' : 'checkbox'}
      accessibilityState={estadoA11y === undefined ? undefined : { checked: estadoA11y }}
      accessibilityLabel={etiqueta}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: espacio.sm,
          padding: espacio.sm,
          marginBottom: espacio.sm,
          borderRadius: radio.medio,
          borderWidth: grosor.fuerte,
          borderColor: borde,
          backgroundColor: fondo,
        },
        pressed && { opacity: 0.9 },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** La casilla del checklist: palomita SVG cuando esta encendida. */
export function Palomita({ encendida }: { encendida: boolean }) {
  return (
    <View
      style={{
        width: 26,
        height: 26,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radio.chico,
        borderWidth: grosor.fuerte,
        borderColor: encendida ? colores.exito : colores.bordeFuerte,
        backgroundColor: encendida ? colores.exito : colores.superficie,
      }}
    >
      {encendida ? <Icono nombre="palomita" tamano={18} color={colores.tintaInversa} /> : null}
    </View>
  );
}
