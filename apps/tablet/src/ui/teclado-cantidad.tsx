import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TeclaNumerica } from '@/estado/venta-pasos';

import { Icono } from './icono';
import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

const FILAS: readonly (readonly (TeclaNumerica | 'borrar' | 'siguiente')[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['borrar', '0', 'siguiente'],
];

/**
 * Teclado de numeros grandes de la lista de Vender (rediseno pieza 2, maqueta
 * 10). Va fijo abajo de la pantalla, en lugar del teclado del sistema: no tapa
 * la barra de estado ni cambia de alto, y "Siguiente" baja al renglon que sigue
 * sin cerrarse. Que hace cada tecla lo decide `teclear` (`venta-pasos.ts`); aqui
 * solo se pinta.
 */
export function TecladoCantidad({
  onTecla,
  onSiguiente,
  etiquetaSiguiente = 'Siguiente',
}: {
  onTecla: (tecla: TeclaNumerica | 'borrar') => void;
  onSiguiente: () => void;
  /** En el ultimo renglon dice "Listo": no hay renglon abajo. */
  etiquetaSiguiente?: string;
}) {
  const { dispositivo, t } = useTema();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        gap: espacio.sm,
        paddingHorizontal: espacio.sm,
        paddingTop: espacio.sm,
        paddingBottom: espacio.sm + insets.bottom,
        backgroundColor: colores.superficieHundida,
        borderTopWidth: grosor.fuerte,
        borderTopColor: colores.bordeFuerte,
      }}
    >
      {FILAS.map((fila) => (
        <View key={fila.join('')} style={{ flexDirection: 'row', gap: espacio.sm }}>
          {fila.map((tecla) => {
            const esSiguiente = tecla === 'siguiente';
            const esBorrar = tecla === 'borrar';
            return (
              <Pressable
                key={tecla}
                accessibilityRole="button"
                accessibilityLabel={esSiguiente ? etiquetaSiguiente : esBorrar ? 'Borrar' : tecla}
                onPress={() => (esSiguiente ? onSiguiente() : onTecla(tecla))}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    minHeight: dispositivo.tactil,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radio.chico,
                    borderWidth: grosor.fuerte,
                    borderColor: esSiguiente ? colores.primario : colores.borde,
                    backgroundColor: esSiguiente
                      ? colores.primario
                      : esBorrar
                        ? colores.superficieHundida
                        : colores.superficie,
                  },
                  pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
                ]}
              >
                {esBorrar ? (
                  <Icono nombre="borrar" tamano={t(tipo.subtitulo)} color={colores.tinta} />
                ) : (
                  <Text
                    style={{
                      fontFamily: esSiguiente ? fuente.cuerpoFuerte : fuente.cifraFuerte,
                      fontSize: t(esSiguiente ? tipo.destacado : tipo.subtitulo),
                      color: esSiguiente ? colores.primarioTinta : colores.tinta,
                    }}
                  >
                    {esSiguiente ? etiquetaSiguiente : tecla}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
