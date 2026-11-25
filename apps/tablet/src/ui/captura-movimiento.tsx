import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { textoTeQuedan } from '@/estado/inventario';

import { Renglon } from './checklist';
import { Cifra } from './cifra';
import { Icono } from './icono';
import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Piezas de las pantallas de Merma y cambios (rediseño pieza 4, maquetas 14 y
 * 16). El renglon es el de la lista de venta (pieza 2): `Renglon` con la caja
 * de cantidad a la derecha; tocarlo abre el `TecladoCantidad` de la pantalla.
 */

/** Un renglon de producto con su caja de cantidad (y "te quedan N" si sale de la camioneta). */
export function RenglonCantidad({
  etiqueta,
  piezas,
  quedan,
  activo,
  onPress,
}: {
  etiqueta: string;
  piezas: number;
  /** La existencia con el control prendido, solo en lo que sale; `null` = no se pinta. */
  quedan: number | null;
  activo: boolean;
  onPress: () => void;
}) {
  const { estilos } = useTema();
  const conAlgo = piezas > 0;
  const aviso = quedan === null ? null : textoTeQuedan(quedan, piezas);
  return (
    <Renglon
      onPress={onPress}
      etiqueta={`${etiqueta}, cantidad ${piezas}`}
      borde={activo || conAlgo ? colores.primario : colores.borde}
      fondo={activo || conAlgo ? colores.primarioTenue : colores.superficie}
    >
      <View style={{ flex: 1 }}>
        <Text style={estilos.textoTarjeta}>{etiqueta}</Text>
        {aviso ? (
          <Text style={[estilos.textoSuave, aviso.falta ? { color: colores.peligro } : null]}>
            {aviso.texto.charAt(0).toLowerCase() + aviso.texto.slice(1)}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          minWidth: 64,
          minHeight: 44,
          paddingHorizontal: espacio.sm,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radio.chico,
          borderWidth: grosor.fuerte,
          borderColor: activo ? colores.primario : colores.borde,
          backgroundColor: colores.superficie,
        }}
      >
        {conAlgo ? <Cifra valor={piezas} tamano="destacado" /> : null}
      </View>
    </Renglon>
  );
}

/** El encabezado de un lado: "Me entregó el cliente (dañado)" y, a la derecha, "opcional". */
export function EncabezadoSeccion({ titulo, nota }: { titulo: string; nota?: string }) {
  const { estilos } = useTema();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginTop: espacio.md,
        marginBottom: espacio.sm,
      }}
    >
      <Text style={[estilos.etiqueta, { marginBottom: 0 }]}>{titulo}</Text>
      {nota ? <Text style={estilos.textoSuave}>{nota}</Text> : null}
    </View>
  );
}

/** "+ Agregar producto": abre el selector de ese lado. */
export function AgregarProducto({ onPress, deshabilitado = false }: { onPress: () => void; deshabilitado?: boolean }) {
  const { t, dispositivo } = useTema();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Agregar producto"
      accessibilityState={{ disabled: deshabilitado }}
      disabled={deshabilitado}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: espacio.sm,
          minHeight: Math.min(dispositivo.tactil, 48),
          marginBottom: espacio.sm,
          borderRadius: radio.medio,
          borderWidth: grosor.fuerte,
          borderStyle: 'dashed',
          borderColor: colores.primario,
          opacity: deshabilitado ? 0.5 : 1,
        },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Icono nombre="mas" tamano={t(tipo.cuerpo)} color={colores.primario} />
      <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.cuerpo), color: colores.primario }}>
        Agregar producto
      </Text>
    </Pressable>
  );
}

/**
 * "Motivo de la merma": el campo con la flecha que despliega la lista del
 * portal (`listarMotivosMerma`). Sin motivos en la tablet, pide sincronizar.
 */
export function SelectorMotivo({
  motivos,
  elegido,
  onElegir,
  onAbrir,
}: {
  motivos: readonly { id: string; nombre: string }[];
  elegido: string | null;
  onElegir: (id: string) => void;
  /** Al desplegar (la pantalla cierra su teclado). */
  onAbrir?: () => void;
}) {
  const { estilos, t, dispositivo } = useTema();
  const [abierto, setAbierto] = useState(false);
  const nombre = motivos.find((m) => m.id === elegido)?.nombre ?? null;

  return (
    <View style={{ marginBottom: espacio.sm }}>
      <Text style={estilos.etiqueta}>Motivo de la merma</Text>
      {motivos.length === 0 ? (
        <Text style={estilos.error}>No hay motivos de merma en la tablet. Sincroniza para bajarlos del portal.</Text>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Motivo de la merma: ${nombre ?? 'sin elegir'}`}
            accessibilityState={{ expanded: abierto }}
            onPress={() => {
              if (!abierto) onAbrir?.();
              setAbierto((a) => !a);
            }}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                minHeight: Math.min(dispositivo.tactil, 52),
                paddingHorizontal: espacio.md,
                borderRadius: radio.medio,
                borderWidth: grosor.fuerte,
                borderColor: abierto ? colores.primario : colores.borde,
                backgroundColor: colores.superficie,
              },
              pressed && { opacity: 0.9 },
            ]}
          >
            <Text
              style={{
                fontFamily: nombre ? fuente.cuerpoFuerte : fuente.cuerpo,
                fontSize: t(tipo.cuerpo),
                color: nombre ? colores.tinta : colores.tintaSuave,
              }}
            >
              {nombre ?? 'Elige el motivo'}
            </Text>
            <Icono nombre="abajo" tamano={t(tipo.subtitulo)} color={colores.tinta} />
          </Pressable>
          {abierto ? (
            <View style={{ marginTop: espacio.sm }}>
              {motivos.map((m) => (
                <Renglon
                  key={m.id}
                  etiqueta={m.nombre}
                  estadoA11y={m.id === elegido}
                  borde={m.id === elegido ? colores.primario : colores.borde}
                  fondo={m.id === elegido ? colores.primarioTenue : colores.superficie}
                  onPress={() => {
                    onElegir(m.id);
                    setAbierto(false);
                  }}
                >
                  <Text style={[estilos.textoTarjeta, { flex: 1 }]}>{m.nombre}</Text>
                  {m.id === elegido ? <Icono nombre="palomita" tamano={t(tipo.cuerpo)} color={colores.primario} /> : null}
                </Renglon>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** La barra fija de abajo (la de la lista de venta): avisos y el boton de grabar. */
export function BarraAbajo({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        gap: espacio.sm,
        paddingHorizontal: espacio.md,
        paddingTop: espacio.sm,
        paddingBottom: espacio.sm + insets.bottom,
        backgroundColor: colores.superficie,
        borderTopWidth: grosor.fuerte,
        borderTopColor: colores.bordeFuerte,
      }}
    >
      {children}
    </View>
  );
}

/**
 * La flecha de la cabecera: primero cierra lo abierto (teclado o selector) con
 * `atras`, igual que el boton fisico; si no habia nada, sale de la pantalla.
 * Mismo patron que la venta (`venta.tsx`).
 */
export function FlechaAtras({ atras }: { atras: () => boolean }) {
  const { t } = useTema();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Atrás"
      hitSlop={espacio.sm}
      onPress={() => {
        if (!atras()) router.back();
      }}
      style={{ paddingRight: espacio.md, paddingVertical: espacio.xs }}
    >
      <Icono nombre="atras" tamano={t(tipo.subtitulo)} color={colores.tinta} />
    </Pressable>
  );
}
