import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';

import type { FilaRutaDelDia } from '@/datos/repositorios/rutas';
import {
  indiceDestino,
  moverElemento,
  primeraLineaDomicilio,
  textoBurbuja,
} from '@/estado/ruta-del-dia';

import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Alto FIJO de cada fila (D10): el arrastre calcula a que renglon cae
 * dividiendo el desplazamiento entre el paso de una fila. Una fila mas alta
 * romperia la cuenta; por eso cada texto va en una sola linea.
 */
export const ALTO_FILA = 96;

/** Hueco entre filas. El paso del arrastre es `ALTO_FILA + HUECO`. */
const HUECO = espacio.sm;

/**
 * Interruptor del arrastre (D10). Si en el emulador o en la tablet resulta
 * fragil, se pone en `false`: quedan los botones subir/bajar, que estan siempre
 * (son el respaldo y la via accesible; un lector de pantalla no arrastra).
 */
export const ARRASTRE_HABILITADO = true;

/** Cuanto hay que mantener presionado para que la fila se "despegue". */
const ESPERA_ARRASTRE_MS = 350;

/** Movimiento maximo, en puntos, que todavia cuenta como toque. */
const TOLERANCIA_TOQUE = 8;

/**
 * La ruta del dia, reordenable (T-37, D10, D16). Muestra lo que le pasan, en
 * ese orden: quien decide que filas van aqui es `agruparRuta`.
 */
export function ListaRuta({
  filas,
  soloLectura,
  onTocar,
  onReordenar,
  onQuitar,
  onArrastrando,
}: {
  filas: readonly FilaRutaDelDia[];
  /** Dia cerrado: sin arrastre ni subir/bajar. */
  soloLectura: boolean;
  onTocar: (clienteId: string) => void;
  /** Recibe los `cliente_id` en el orden nuevo. Se guarda sin confirmar. */
  onReordenar: (clienteIds: string[]) => void;
  onQuitar: (id: string) => void;
  /** Mientras se arrastra, la pantalla apaga el scroll: si no, el scroll se lleva el gesto. */
  onArrastrando: (arrastrando: boolean) => void;
}) {
  const [arrastre, setArrastre] = useState<{ desde: number; dy: number } | null>(null);
  // La fila que se arrastra, tambien fuera del estado: `terminar` la necesita
  // en el mismo evento en que se suelta, sin esperar un render.
  const desdeRef = useRef<number | null>(null);
  const ids = useMemo(() => filas.map((f) => f.cliente_id), [filas]);

  const iniciar = useCallback(
    (desde: number) => {
      desdeRef.current = desde;
      setArrastre({ desde, dy: 0 });
      onArrastrando(true);
    },
    [onArrastrando],
  );

  const mover = useCallback((dy: number) => {
    setArrastre((a) => (a ? { ...a, dy } : a));
  }, []);

  /** `dy = null`: el sistema corto el gesto; se cancela sin mover nada. */
  const terminar = useCallback(
    (dy: number | null) => {
      const desde = desdeRef.current;
      desdeRef.current = null;
      setArrastre(null);
      onArrastrando(false);
      if (desde === null || dy === null) return;
      const hasta = indiceDestino(desde, dy, ALTO_FILA + HUECO, ids.length);
      if (hasta !== desde) onReordenar(moverElemento(ids, desde, hasta));
    },
    [ids, onArrastrando, onReordenar],
  );

  const destino =
    arrastre === null
      ? null
      : indiceDestino(arrastre.desde, arrastre.dy, ALTO_FILA + HUECO, ids.length);

  return (
    <View style={{ gap: HUECO }}>
      {filas.map((fila, indice) => {
        const esta = arrastre?.desde === indice;
        return (
          <FilaRuta
            key={fila.id}
            fila={fila}
            indice={indice}
            total={filas.length}
            soloLectura={soloLectura}
            desplazamiento={esta ? (arrastre?.dy ?? 0) : null}
            destino={esta ? destino : null}
            onTocar={onTocar}
            onIniciar={iniciar}
            onMover={mover}
            onSoltar={terminar}
            onSubir={() => onReordenar(moverElemento(ids, indice, indice - 1))}
            onBajar={() => onReordenar(moverElemento(ids, indice, indice + 1))}
            onQuitar={onQuitar}
          />
        );
      })}
    </View>
  );
}

function FilaRuta({
  fila,
  indice,
  total,
  soloLectura,
  desplazamiento,
  destino,
  onTocar,
  onIniciar,
  onMover,
  onSoltar,
  onSubir,
  onBajar,
  onQuitar,
}: {
  fila: FilaRutaDelDia;
  indice: number;
  total: number;
  soloLectura: boolean;
  /** `null` si esta fila no es la que se arrastra. */
  desplazamiento: number | null;
  destino: number | null;
  onTocar: (clienteId: string) => void;
  onIniciar: (indice: number) => void;
  onMover: (dy: number) => void;
  onSoltar: (dy: number | null) => void;
  onSubir: () => void;
  onBajar: () => void;
  onQuitar: (id: string) => void;
}) {
  const { t } = useTema();
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrastrando = useRef(false);

  const responder = useMemo(() => {
    const cancelarEspera = () => {
      if (temporizador.current !== null) {
        clearTimeout(temporizador.current);
        temporizador.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/refs -- los refs se leen solo en los handlers del gesto, nunca en render; `create` solo guarda los callbacks
    return PanResponder.create({
      // La fila toma el toque; los botones de dentro (subir, bajar, quitar) lo
      // reclaman antes porque son mas profundos.
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        arrastrando.current = false;
        if (soloLectura || !ARRASTRE_HABILITADO) return;
        temporizador.current = setTimeout(() => {
          temporizador.current = null;
          arrastrando.current = true;
          onIniciar(indice);
        }, ESPERA_ARRASTRE_MS);
      },
      onPanResponderMove: (_evento, gesto) => {
        if (arrastrando.current) {
          onMover(gesto.dy);
          return;
        }
        // Se movio antes de despegarse: es un scroll, no un arrastre.
        if (Math.abs(gesto.dx) > TOLERANCIA_TOQUE || Math.abs(gesto.dy) > TOLERANCIA_TOQUE) {
          cancelarEspera();
        }
      },
      // Mientras arrastra, nadie (ni el scroll) le quita el gesto.
      onPanResponderTerminationRequest: () => !arrastrando.current,
      onPanResponderRelease: (_evento, gesto) => {
        cancelarEspera();
        if (arrastrando.current) {
          arrastrando.current = false;
          onSoltar(gesto.dy);
          return;
        }
        if (Math.abs(gesto.dx) <= TOLERANCIA_TOQUE && Math.abs(gesto.dy) <= TOLERANCIA_TOQUE) {
          onTocar(fila.cliente_id);
        }
      },
      onPanResponderTerminate: () => {
        cancelarEspera();
        if (arrastrando.current) {
          arrastrando.current = false;
          onSoltar(null);
        }
      },
    });
  }, [fila.cliente_id, indice, soloLectura, onTocar, onIniciar, onMover, onSoltar]);

  const conError = fila.sync_estado === 'error';
  const arrastrada = desplazamiento !== null;

  return (
    <View
      {...responder.panHandlers}
      style={[
        {
          height: ALTO_FILA,
          flexDirection: 'row',
          alignItems: 'center',
          gap: espacio.md,
          paddingHorizontal: espacio.md,
          borderRadius: radio.medio,
          borderWidth: grosor.hairline,
          borderColor: colores.borde,
          backgroundColor: colores.superficie,
        },
        // Visitado: atenuado y con palomita, sin salir de la lista (D2, D5).
        fila.visitado && { opacity: 0.55 },
        arrastrada && {
          transform: [{ translateY: desplazamiento ?? 0 }],
          zIndex: 10,
          elevation: 6,
          opacity: 1,
          borderWidth: grosor.fuerte,
          borderColor: colores.primario,
        },
      ]}
    >
      <Text
        style={{
          width: 36,
          textAlign: 'right',
          fontFamily: fuente.cifraFuerte,
          fontSize: t(tipo.destacado),
          color: colores.tintaSuave,
        }}
      >
        {indice + 1}
      </Text>

      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}
        >
          {fila.visitado ? '✓ ' : ''}
          {fila.nombre}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.cuerpo), color: colores.tintaSuave }}
        >
          {primeraLineaDomicilio(fila.domicilio)}
        </Text>
        {conError ? (
          // Mismo tratamiento que una venta rechazada: texto rojo bajo la fila.
          <Text
            numberOfLines={1}
            style={{ fontFamily: fuente.cuerpoMedio, fontSize: t(tipo.menor), color: colores.peligro }}
          >
            Rechazado: {fila.sync_error}
          </Text>
        ) : destino !== null ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fuente.cuerpoMedio, fontSize: t(tipo.menor), color: colores.primario }}
          >
            Suelta para dejarlo en el lugar {destino + 1}
          </Text>
        ) : fila.sync_estado === 'pendiente' ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fuente.cuerpoMedio, fontSize: t(tipo.menor), color: colores.aviso }}
          >
            Por subir
          </Text>
        ) : null}
      </View>

      {fila.notas_pendientes > 0 ? <Burbuja notas={fila.notas_pendientes} /> : null}

      {conError ? (
        <BotonChico
          etiqueta="Quitar"
          etiquetaAccesible={`Quitar ${fila.nombre} de la ruta`}
          onPress={() => onQuitar(fila.id)}
        />
      ) : null}

      {soloLectura ? null : (
        <View style={{ gap: espacio.xs }}>
          <BotonChico
            etiqueta="▲"
            etiquetaAccesible={`Subir ${fila.nombre}`}
            deshabilitado={indice === 0}
            onPress={onSubir}
          />
          <BotonChico
            etiqueta="▼"
            etiquetaAccesible={`Bajar ${fila.nombre}`}
            deshabilitado={indice === total - 1}
            onPress={onBajar}
          />
        </View>
      )}
    </View>
  );
}

/** Un cliente que la oficina quito pero que hoy tuvo actividad: "Fuera de ruta" (D16). */
export function FilaFueraDeRuta({
  fila,
  onTocar,
}: {
  fila: FilaRutaDelDia;
  onTocar: (clienteId: string) => void;
}) {
  const { t } = useTema();
  return (
    <Pressable
      onPress={() => onTocar(fila.cliente_id)}
      accessibilityRole="button"
      accessibilityLabel={`${fila.nombre}, fuera de ruta, visitado`}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: espacio.md,
          padding: espacio.md,
          borderRadius: radio.medio,
          borderWidth: grosor.hairline,
          borderColor: colores.borde,
          backgroundColor: colores.superficieHundida,
          opacity: 0.75,
        },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.exito }}>
        ✓
      </Text>
      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}
        >
          {fila.nombre}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.cuerpo), color: colores.tintaSuave }}
        >
          {primeraLineaDomicilio(fila.domicilio)}
        </Text>
      </View>
      {fila.notas_pendientes > 0 ? <Burbuja notas={fila.notas_pendientes} /> : null}
    </Pressable>
  );
}

/** La burbuja: cuantas notas con saldo tiene el cliente. Solo si es mayor a cero. */
function Burbuja({ notas }: { notas: number }) {
  const { t } = useTema();
  return (
    <View
      accessible
      accessibilityLabel={textoBurbuja(notas)}
      style={{
        minWidth: 32,
        height: 32,
        paddingHorizontal: espacio.sm,
        borderRadius: radio.pastilla,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colores.primario,
      }}
    >
      <Text style={{ fontFamily: fuente.cifraFuerte, fontSize: t(tipo.cuerpo), color: colores.primarioTinta }}>
        {notas}
      </Text>
    </View>
  );
}

function BotonChico({
  etiqueta,
  etiquetaAccesible,
  onPress,
  deshabilitado = false,
}: {
  etiqueta: string;
  etiquetaAccesible: string;
  onPress: () => void;
  deshabilitado?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitado}
      hitSlop={espacio.xs}
      accessibilityRole="button"
      accessibilityLabel={etiquetaAccesible}
      accessibilityState={{ disabled: deshabilitado }}
      style={({ pressed }) => [
        {
          minWidth: 40,
          height: 40,
          paddingHorizontal: espacio.sm,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radio.chico,
          borderWidth: grosor.fuerte,
          borderColor: colores.bordeFuerte,
          backgroundColor: colores.superficie,
        },
        pressed && !deshabilitado && { opacity: 0.7 },
        // Mismo valor que `Boton` inactivo: al sol, menos que esto no se nota.
        deshabilitado && { opacity: 0.35 },
      ]}
    >
      <Text style={{ fontFamily: fuente.cuerpoFuerte, color: colores.tinta }}>{etiqueta}</Text>
    </Pressable>
  );
}
