import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import {
  ALTO_RECUADRO_FIRMA,
  conLimiteDeTiempo,
  ErrorFirma,
  GROSOR_TRAZO_FIRMA,
  MS_MAX_EXPORTAR_FIRMA,
  PAPEL_FIRMA,
  quitarPrefijoDataUrl,
  TINTA_FIRMA,
  trazoAPath,
  type Punto,
} from '@/estado/firma';

import { Boton } from './boton';
import { colores, espacio, grosor, radio } from './tokens';

/** Lo que la pantalla puede pedirle al recuadro por `ref`. */
export interface ControlFirma {
  /** El dibujo como PNG en base64, sin prefijo `data:`. Rechaza si no llega en {@link MS_MAX_EXPORTAR_FIRMA}. */
  exportarPng(): Promise<string>;
  /** Vacia los trazos (lo mismo que "Borrar firma"). */
  borrar(): void;
}

interface Props {
  /** Los trazos, en el estado de la pantalla: asi "Corregir" puede vaciarlos (D4). */
  trazos: Punto[][];
  alCambiar: (trazos: Punto[][]) => void;
  /** Mientras se graba no se dibuja ni se borra. */
  deshabilitado?: boolean;
}

/**
 * El recuadro donde firma el cliente (T-73, D5).
 *
 * - Papel **blanco** tambien con el sistema en modo noche: el fondo es un
 *   `<Rect>` DENTRO del `Svg`, asi que el PNG de `toDataURL` sale opaco y el JPG
 *   no se vuelve negro (Review Focus 1).
 * - `PanResponder` en un `View` que envuelve al `Svg`, y el `Svg` con
 *   `pointerEvents="none"`: asi `locationX/Y` son siempre relativos al recuadro y
 *   no al trazo que el dedo este tocando.
 * - Cada trazo es un `<Path>`; un toque sin arrastre es un circulo minimo
 *   (`trazoAPath`).
 */
export const RecuadroFirma = forwardRef<ControlFirma, Props>(function RecuadroFirma(
  { trazos, alCambiar, deshabilitado = false },
  ref,
) {
  const svg = useRef<Svg>(null);
  // El PanResponder se crea una vez; lee lo ultimo por refs.
  const actuales = useRef(trazos);
  const avisar = useRef(alCambiar);
  const bloqueado = useRef(deshabilitado);
  useEffect(() => {
    actuales.current = trazos;
  }, [trazos]);
  useEffect(() => {
    avisar.current = alCambiar;
  }, [alCambiar]);
  useEffect(() => {
    bloqueado.current = deshabilitado;
  }, [deshabilitado]);

  const gestos = useMemo(() => {
    const punto = (e: GestureResponderEvent): Punto => ({
      x: e.nativeEvent.locationX,
      y: e.nativeEvent.locationY,
    });
    const publicar = (nuevos: Punto[][]) => {
      actuales.current = nuevos;
      avisar.current(nuevos);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !bloqueado.current,
      onMoveShouldSetPanResponder: () => !bloqueado.current,
      // El recuadro reclama el toque al empezar y se niega a soltarlo: asi el
      // ScrollView no se lo quita y la pantalla no se desplaza. No hay que
      // re-renderizar la pantalla a media firma (p. ej. apagando `scrollEnabled`
      // por estado): en el emulador eso cancelaba el PanResponder y cortaba el trazo.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        publicar([...actuales.current, [punto(e)]]);
      },
      onPanResponderMove: (e) => {
        const previos = actuales.current;
        const ultimo = previos[previos.length - 1] ?? [];
        publicar([...previos.slice(0, -1), [...ultimo, punto(e)]]);
      },
    });
  }, []);

  // La unica logica de "borrar": la usan el boton y el `ref`.
  const borrar = useCallback(() => {
    actuales.current = [];
    avisar.current([]);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      exportarPng: () =>
        conLimiteDeTiempo(
          new Promise<string>((resolve, reject) => {
            const actual = svg.current;
            if (!actual) {
              reject(new ErrorFirma('El recuadro de firma no está en pantalla.'));
              return;
            }
            actual.toDataURL((base64: string) => resolve(quitarPrefijoDataUrl(base64)));
          }),
          MS_MAX_EXPORTAR_FIRMA,
          'La firma tardó demasiado en guardarse.',
        ),
      borrar,
    }),
    [borrar],
  );

  return (
    <View style={{ gap: espacio.sm, marginTop: espacio.sm }}>
      <View
        {...gestos.panHandlers}
        accessibilityLabel="Recuadro para la firma del cliente"
        style={{
          height: ALTO_RECUADRO_FIRMA,
          borderWidth: grosor.fuerte,
          borderColor: colores.bordeFuerte,
          borderRadius: radio.medio,
          overflow: 'hidden',
        }}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg ref={svg} width="100%" height="100%">
            <Rect x={0} y={0} width="100%" height="100%" fill={PAPEL_FIRMA} />
            {trazos.map((t, i) => (
              <Path
                key={i}
                d={trazoAPath(t)}
                stroke={TINTA_FIRMA}
                strokeWidth={GROSOR_TRAZO_FIRMA}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </Svg>
        </View>
      </View>
      <Boton
        etiqueta="Borrar firma"
        tono="neutra"
        ancho="ajustado"
        onPress={borrar}
        deshabilitado={deshabilitado || trazos.length === 0}
      />
    </View>
  );
});
