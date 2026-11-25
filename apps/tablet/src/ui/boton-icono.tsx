import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Icono } from './icono';
import type { NombreIcono } from './iconos';
import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Boton cuadrado de solo icono, para la cabecera de la ruta del dia (rediseno
 * del menu, 2026-10-18): menu, agregar y sincronizar.
 *
 * El icono solo no dice nada a TalkBack: `etiqueta` es obligatoria y es lo que
 * se lee. 48dp es el minimo tactil de Android; con `hitSlop` el dedo alcanza
 * 56dp, que es el `tactil` de tablet del sistema de diseno.
 *
 * `numero` pinta una burbuja en la esquina (hoy: lo que falta por subir en sincronizar),
 * porque al quitar la pastilla de la barra ese dato no puede desaparecer de la
 * pantalla principal: es lo que le dice al vendedor que tiene que sincronizar.
 */
export function BotonIcono({
  icono,
  etiqueta,
  onPress,
  deshabilitado = false,
  ocupado = false,
  numero,
}: {
  icono: NombreIcono;
  etiqueta: string;
  onPress: () => void;
  deshabilitado?: boolean;
  ocupado?: boolean;
  numero?: number;
}) {
  const { t } = useTema();
  const inactivo = deshabilitado || ocupado;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactivo}
      hitSlop={espacio.xs}
      accessibilityRole="button"
      accessibilityLabel={numero ? `${etiqueta}. ${numero} por subir` : etiqueta}
      accessibilityState={{ disabled: inactivo, busy: ocupado }}
      style={({ pressed }) => [
        {
          width: 48,
          height: 48,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radio.chico,
          borderWidth: grosor.fuerte,
          borderColor: colores.bordeFuerte,
          backgroundColor: colores.superficie,
        },
        pressed && !inactivo && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
        deshabilitado && { opacity: 0.35 },
      ]}
    >
      {ocupado ? (
        <ActivityIndicator color={colores.tinta} />
      ) : (
        <Icono nombre={icono} tamano={t(tipo.subtitulo)} color={colores.tinta} />
      )}
      {numero ? (
        <View
          style={{
            position: 'absolute',
            top: -espacio.sm,
            right: -espacio.sm,
            minWidth: 22,
            height: 22,
            paddingHorizontal: espacio.xs,
            borderRadius: radio.pastilla,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colores.aviso,
          }}
        >
          <Text style={{ fontFamily: fuente.cifraFuerte, fontSize: t(tipo.menor), color: colores.primarioTinta }}>
            {numero > 99 ? '99+' : numero}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
