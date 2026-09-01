import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native';

import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Tono de un boton. **Es semantica, no decoracion**: el tono dice que le pasa
 * al mundo cuando el vendedor lo toca, y de ahi salen la forma y el color.
 *
 * - `primaria` — la accion que la pantalla espera. Relleno naranja. Una sola
 *   por pantalla; si hay dos, ninguna es la principal.
 * - `confirmar` — suma, acepta, cuadra. Relleno verde.
 * - `neutra` — navegar, cancelar, cerrar. Contorno sobre superficie.
 * - `peligro` — resta, devuelve, borra, cierra sesion. **Contorno grueso rojo,
 *   nunca relleno.**
 */
export type Tono = 'primaria' | 'confirmar' | 'neutra' | 'peligro';

/**
 * Boton del sistema.
 *
 * ## Por que `peligro` va con contorno y no relleno
 *
 * Un boton rojo relleno es visualmente el mas pesado de la pantalla, y el peso
 * visual **invita al dedo**. Justo lo contrario de lo que se quiere en la
 * accion que no tiene vuelta atras. En contorno pesa menos, pide un instante
 * mas de atencion, y sigue siendo inconfundible.
 *
 * ## El `glifo` no es adorno — es la correccion de un fallo reportado
 *
 * > [!danger] El cliente ya reporto este error en produccion
 * > "Los vendedores se equivocan mucho entre los botones de **aceptar** y
 * > **devolver** producto" (`10-Dominio/Modulos/Inventario.md`, Cambios v2.0).
 *
 * Distinguirlos solo por color **no lo arregla**: cerca del 8% de los hombres
 * tiene alguna deficiencia de vision al color, y aqui todos los usuarios son
 * hombres en ruta, mirando la pantalla al sol y de reojo. Por eso dos botones
 * que hacen cosas opuestas tienen que diferir en **tres ejes a la vez**:
 *
 * 1. **Glifo** distinto (`+` contra `−`), en su propia caja con borde.
 * 2. **Forma** distinta (relleno contra contorno).
 * 3. **Color** distinto (verde contra rojo).
 *
 * Quitale el color a la pantalla y los dos botones siguen siendo distintos.
 * Esa es la prueba, y es la regla para T-27 (inventario) cuando se construya.
 *
 * ```tsx
 * <Boton tono="confirmar" glifo="+" etiqueta="Aceptar producto" onPress={…} />
 * <Boton tono="peligro"   glifo="−" etiqueta="Devolver producto" onPress={…} />
 * ```
 */
export function Boton({
  etiqueta,
  onPress,
  tono = 'primaria',
  glifo,
  ocupado = false,
  deshabilitado = false,
  ancho = 'completo',
  estilo,
}: {
  etiqueta: string;
  onPress: () => void;
  tono?: Tono;
  /** Simbolo corto (`+`, `−`, `✓`, `↻`). Obligatorio cuando hay un opuesto. */
  glifo?: string;
  /** Muestra un indicador y bloquea el toque. */
  ocupado?: boolean;
  deshabilitado?: boolean;
  /** `completo` ocupa la fila; `ajustado` se encoge al contenido. */
  ancho?: 'completo' | 'ajustado';
  estilo?: ViewStyle;
}) {
  const { dispositivo, t } = useTema();
  const inactivo = deshabilitado || ocupado;

  const paleta: Record<Tono, { fondo: string; borde: string; texto: string; grosor: number }> = {
    primaria: {
      fondo: colores.primario,
      borde: colores.primario,
      texto: colores.primarioTinta,
      grosor: grosor.fuerte,
    },
    confirmar: {
      fondo: colores.exito,
      borde: colores.exito,
      texto: colores.tintaInversa,
      grosor: grosor.fuerte,
    },
    neutra: {
      fondo: colores.superficie,
      borde: colores.bordeFuerte,
      texto: colores.tinta,
      grosor: grosor.fuerte,
    },
    // Contorno, nunca relleno. Ver la nota de arriba.
    peligro: {
      fondo: 'transparent',
      borde: colores.peligro,
      texto: colores.peligro,
      grosor: grosor.acento,
    },
  };

  const p = paleta[tono];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityState={{ disabled: inactivo, busy: ocupado }}
      onPress={onPress}
      disabled={inactivo}
      style={({ pressed }) => [
        {
          minHeight: dispositivo.tactil,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: espacio.sm,
          paddingHorizontal: espacio.lg,
          borderRadius: radio.chico,
          backgroundColor: p.fondo,
          borderWidth: p.grosor,
          borderColor: p.borde,
          flexGrow: ancho === 'completo' ? 1 : 0,
          alignSelf: ancho === 'completo' ? 'auto' : 'flex-start',
        },
        // Se hunde en vez de solo aclararse: al sol, un cambio de opacidad del
        // 40% casi no se nota, pero el desplazamiento si.
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
        inactivo && { opacity: 0.35 },
        estilo,
      ]}
    >
      {ocupado ? (
        <ActivityIndicator color={p.texto} />
      ) : (
        <>
          {glifo ? (
            <View
              style={{
                minWidth: t(tipo.destacado) + espacio.sm,
                paddingHorizontal: espacio.xs,
                paddingVertical: 1,
                borderRadius: radio.chico - 2,
                borderWidth: grosor.hairline,
                borderColor: p.texto,
              }}
            >
              <Text
                style={{
                  fontFamily: fuente.cifraFuerte,
                  fontSize: t(tipo.destacado),
                  lineHeight: t(tipo.destacado) * 1.2,
                  textAlign: 'center',
                  color: p.texto,
                }}
              >
                {glifo}
              </Text>
            </View>
          ) : null}
          <Text
            style={{
              fontFamily: fuente.cuerpoFuerte,
              fontSize: t(tipo.destacado),
              letterSpacing: 0.3,
              color: p.texto,
            }}
          >
            {etiqueta}
          </Text>
        </>
      )}
    </Pressable>
  );
}
