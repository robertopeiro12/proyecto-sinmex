import { useRouter, type Href } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useTema } from "./tema";
import { colores, espacio, fuente, grosor, tipo } from "./tokens";

/**
 * Tarjeta grande de navegacion de la jornada.
 *
 * El ancho lo decide la rejilla (`estilos.celdaRejilla`), que a su vez sale del
 * dispositivo: una columna en telefono, dos en tablet chica, tres en tablet
 * horizontal. La tarjeta no sabe nada de eso — solo se estira.
 *
 * Cuando la seccion tiene algo que reclamar (registros sin subir, una jornada a
 * medias), `nota` lo dice **en la tarjeta**, para que el vendedor no tenga que
 * entrar a cada una para descubrir donde quedo trabajo pendiente.
 */
export function BotonMenu({
  titulo,
  descripcion,
  destino,
  nota,
  destacada = false,
  deshabilitado = false,
}: {
  titulo: string;
  descripcion: string;
  destino: Href;
  /** Aviso corto que se pinta en el tono de accion. */
  nota?: string;
  /** La accion que la jornada espera ahora mismo. */
  destacada?: boolean;
  /**
   * La seccion no esta disponible ahora (T-38: el dia ya se cerro). No navega y
   * se atenua igual que un `Boton` inactivo (opacidad 0.35).
   */
  deshabilitado?: boolean;
}) {
  const { estilos, dispositivo, t } = useTema();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => {
        if (!deshabilitado) router.push(destino);
      }}
      disabled={deshabilitado}
      accessibilityRole="link"
      accessibilityLabel={`${titulo}. ${descripcion}`}
      accessibilityState={{ disabled: deshabilitado }}
      style={({ pressed }) => [
        estilos.tarjeta,
        estilos.celdaRejilla,
        {
          borderWidth: grosor.fuerte,
          borderColor: destacada ? colores.primario : colores.bordeFuerte,
          minHeight: Math.max(dispositivo.tactil + espacio.xl, 104),
        },
        destacada && { backgroundColor: colores.primarioTenue },
        pressed && !deshabilitado && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
        // Mismo valor que `Boton` inactivo: al sol, menos que esto no se nota.
        deshabilitado && { opacity: 0.35 },
      ]}
    >
      <View style={{ gap: espacio.xs }}>
        <Text
          style={{
            fontFamily: fuente.tituloMedio,
            fontSize: t(tipo.subtitulo),
            lineHeight: t(tipo.subtitulo) * 1.15,
            color: colores.tinta,
          }}
        >
          {titulo}
        </Text>
        <Text style={estilos.textoSuave}>{descripcion}</Text>
        {nota ? (
          <Text
            style={{
              fontFamily: fuente.cuerpoFuerte,
              fontSize: t(tipo.menor),
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: colores.primario,
              marginTop: espacio.xs,
            }}
          >
            {nota}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
