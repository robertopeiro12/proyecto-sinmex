import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { anchoMenuLateral, type EntradaMenu } from '@/estado/ruta-del-dia';

import { Icono } from './icono';
import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/** Lo que tarda el deslizamiento. Corto: el vendedor va de pie y con prisa. */
const DURACION_MS = 220;
/** Cuanto se oscurece la ruta con el menu abierto. Al sol, menos no se nota. */
const OPACIDAD_VELO = 0.45;

/**
 * Menu hamburguesa como cajon lateral que **empuja** la pantalla (rediseno de
 * Mario, 2026-10-18; sustituye a la hoja modal de T-37, D9).
 *
 * El menu vive debajo, pegado a la izquierda; al abrir, la pantalla entera
 * (cabecera incluida) se desliza a la derecha el ancho del menu y queda
 * oscurecida. Tocar la franja oscura o el boton "atras" de Android lo cierra.
 *
 * Con `Animated` de React Native y `useNativeDriver`: no hace falta
 * `react-native-reanimated` ni recompilar el APK, y la animacion corre en el
 * hilo nativo aunque el JS este ocupado leyendo SQLite.
 *
 * Accesibilidad: con el menu abierto, el contenido empujado se oculta al lector
 * de pantalla (si no, TalkBack leeria la ruta debajo del velo).
 */
export function MenuLateral({
  abierto,
  onCerrar,
  entradas,
  onElegir,
  pie,
  children,
}: {
  abierto: boolean;
  onCerrar: () => void;
  entradas: readonly EntradaMenu[];
  onElegir: (entrada: EntradaMenu) => void;
  /** Al fondo del menu, separado (hoy: el pie con vendedor, vehiculo y sucursal). */
  pie?: ReactNode;
  /** La pantalla que se desliza. */
  children: ReactNode;
}) {
  const { t } = useTema();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const ancho = anchoMenuLateral(width);

  // `useState` y no `useRef`: el valor animado se crea una vez y se lee al pintar.
  const [progreso] = useState(() => new Animated.Value(abierto ? 1 : 0));
  // El menu se monta solo mientras se ve o se esta cerrando: cerrado no debe
  // quedar debajo de la pantalla recibiendo foco del lector. `enCierre` se
  // deriva al pintar (patron "estado a partir de props" de React), no en un
  // efecto, para no encadenar renders.
  const [abiertoPrevio, setAbiertoPrevio] = useState(abierto);
  const [enCierre, setEnCierre] = useState(false);
  if (abierto !== abiertoPrevio) {
    setAbiertoPrevio(abierto);
    setEnCierre(!abierto);
  }
  const montado = abierto || enCierre;

  useEffect(() => {
    Animated.timing(progreso, {
      toValue: abierto ? 1 : 0,
      duration: DURACION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !abierto) setEnCierre(false);
    });
  }, [abierto, progreso]);

  // "Atras" de Android cierra el menu en vez de salir de la ruta.
  useEffect(() => {
    if (!abierto) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCerrar();
      return true;
    });
    return () => sub.remove();
  }, [abierto, onCerrar]);

  const desplazamiento = progreso.interpolate({ inputRange: [0, 1], outputRange: [0, ancho] });
  const velo = progreso.interpolate({ inputRange: [0, 1], outputRange: [0, OPACIDAD_VELO] });

  return (
    <View style={{ flex: 1, backgroundColor: colores.superficie }}>
      {montado ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              width: ancho,
              paddingTop: insets.top + espacio.md,
              paddingBottom: insets.bottom + espacio.md,
              backgroundColor: colores.superficie,
            },
          ]}
          accessibilityViewIsModal
        >
          <ScrollView contentContainerStyle={{ paddingHorizontal: espacio.md, gap: espacio.xs }}>
            {entradas.map((entrada) => (
              <Pressable
                key={entrada.clave}
                disabled={entrada.deshabilitada}
                onPress={() => onElegir(entrada)}
                accessibilityRole="link"
                accessibilityLabel={entrada.nota ? `${entrada.titulo}. ${entrada.nota}` : entrada.titulo}
                accessibilityState={{ disabled: entrada.deshabilitada }}
                style={({ pressed }) => [
                  {
                    minHeight: 56,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: espacio.sm,
                    paddingVertical: espacio.sm,
                    paddingHorizontal: espacio.sm,
                    borderRadius: radio.chico,
                  },
                  pressed && !entrada.deshabilitada && { backgroundColor: colores.primarioTenue },
                  entrada.deshabilitada && { opacity: 0.45 },
                ]}
              >
                <Icono nombre={entrada.icono} tamano={24} color={colores.tinta} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}
                  >
                    {entrada.titulo}
                  </Text>
                  {entrada.nota ? (
                    <Text style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.menor), color: colores.tintaSuave }}>
                      {entrada.nota}
                    </Text>
                  ) : null}
                </View>
                {entrada.deshabilitada && entrada.nota ? (
                  <Icono nombre="candado" tamano={20} color={colores.tintaSuave} />
                ) : null}
              </Pressable>
            ))}
            {pie ? <View style={{ marginTop: espacio.lg }}>{pie}</View> : null}
          </ScrollView>
        </View>
      ) : null}

      <Animated.View
        style={{
          flex: 1,
          transform: [{ translateX: desplazamiento }],
          // Sombra del borde que se desliza, para separar la pantalla del menu.
          borderLeftWidth: abierto ? grosor.hairline : 0,
          borderLeftColor: colores.bordeFuerte,
        }}
        importantForAccessibility={abierto ? 'no-hide-descendants' : 'auto'}
      >
        {children}
        {montado ? (
          <Animated.View
            pointerEvents={abierto ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, { backgroundColor: colores.tinta, opacity: velo }]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onCerrar}
              accessibilityRole="button"
              accessibilityLabel="Cerrar el menú"
            />
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}
