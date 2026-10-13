import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { EntradaMenu } from '@/estado/ruta-del-dia';

import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Menu hamburguesa como hoja modal desde arriba a la derecha (T-37, D9).
 *
 * `Modal` de React Native y no un cajon lateral: el cajon exigiria
 * `react-native-gesture-handler` y `react-native-reanimated`, que la app no
 * trae, y recompilar. Las entradas las decide `entradasMenu` (puro, con prueba).
 */
export function MenuHoja({
  visible,
  entradas,
  onElegir,
  onCerrar,
  pie,
}: {
  visible: boolean;
  entradas: readonly EntradaMenu[];
  onElegir: (entrada: EntradaMenu) => void;
  onCerrar: () => void;
  /** Lo que va al fondo de la hoja, separado (hoy: "Cerrar sesión"). */
  pie?: ReactNode;
}) {
  const { t } = useTema();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={{ flex: 1 }}>
        {/* El fondo cierra el menu; la hoja va encima como hermana, no como hija. */}
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(25, 20, 16, 0.35)' }]}
          onPress={onCerrar}
          accessibilityRole="button"
          accessibilityLabel="Cerrar el menú"
        />
        <View
          style={{
            position: 'absolute',
            top: insets.top + espacio.md,
            right: espacio.md,
            width: 360,
            maxWidth: '90%',
            gap: espacio.xs,
            padding: espacio.md,
            borderRadius: radio.medio,
            borderWidth: grosor.fuerte,
            borderColor: colores.bordeFuerte,
            backgroundColor: colores.superficie,
          }}
        >
          {entradas.map((entrada) => (
            <Pressable
              key={entrada.clave}
              disabled={entrada.deshabilitada}
              onPress={() => onElegir(entrada)}
              accessibilityRole="link"
              accessibilityLabel={`${entrada.titulo}. ${entrada.descripcion}`}
              accessibilityState={{ disabled: entrada.deshabilitada }}
              style={({ pressed }) => [
                {
                  minHeight: 48,
                  justifyContent: 'center',
                  paddingVertical: espacio.sm,
                  paddingHorizontal: espacio.sm,
                  borderRadius: radio.chico,
                },
                pressed && !entrada.deshabilitada && { backgroundColor: colores.primarioTenue },
                entrada.deshabilitada && { opacity: 0.35 },
              ]}
            >
              <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}>
                {entrada.titulo}
              </Text>
              <Text style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.menor), color: colores.tintaSuave }}>
                {entrada.descripcion}
              </Text>
            </Pressable>
          ))}
          {pie ? <View style={{ marginTop: espacio.md }}>{pie}</View> : null}
        </View>
      </View>
    </Modal>
  );
}
