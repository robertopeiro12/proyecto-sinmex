import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { Cifra } from './cifra';
import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Envoltura de una pantalla: fondo, margen segun dispositivo, columna de
 * lectura acotada y scroll.
 *
 * Existe para que ninguna pantalla vuelva a decidir su propio padding. Antes
 * cada una repetia `estilos.pantalla` con retoques sueltos y el resultado eran
 * margenes distintos entre pantallas contiguas.
 *
 * `formulario` centra la columna y esquiva el teclado — lo que necesitan
 * `login` y `abrir-dia`, donde el teclado tapaba el boton en telefono.
 */
export function Pantalla({
  titulo,
  subtitulo,
  children,
  formulario = false,
}: {
  titulo?: string;
  subtitulo?: ReactNode;
  children: ReactNode;
  formulario?: boolean;
}) {
  const { estilos } = useTema();

  const cuerpo = (
    <ScrollView
      style={estilos.pantalla}
      contentContainerStyle={formulario ? estilos.contenidoCentrado : estilos.contenido}
      keyboardShouldPersistTaps="handled"
    >
      {titulo ? <Text style={estilos.titulo}>{titulo}</Text> : null}
      {typeof subtitulo === 'string' ? (
        <Text style={estilos.subtitulo}>{subtitulo}</Text>
      ) : (
        subtitulo
      )}
      {children}
    </ScrollView>
  );

  if (!formulario) return cuerpo;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colores.papel }}
      // En Android el ajuste lo hace el sistema (`windowSoftInputMode`);
      // forzar `padding` aqui pelea con el y deja huecos.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {cuerpo}
    </KeyboardAvoidingView>
  );
}

/** Estado semantico de una tarjeta o pastilla. */
export type Estado = 'neutro' | 'pendiente' | 'listo' | 'error' | 'accion';

const PALETA: Record<Estado, { linea: string; fondo: string; texto: string }> = {
  neutro: { linea: colores.borde, fondo: colores.superficie, texto: colores.tintaSuave },
  pendiente: { linea: colores.aviso, fondo: colores.avisoTenue, texto: colores.aviso },
  listo: { linea: colores.exito, fondo: colores.exitoTenue, texto: colores.exito },
  error: { linea: colores.peligro, fondo: colores.peligroTenue, texto: colores.peligro },
  accion: { linea: colores.primario, fondo: colores.primarioTenue, texto: colores.primario },
};

/**
 * Tarjeta con una **barra de acento** a la izquierda que codifica su estado.
 *
 * La barra es un segundo canal ademas del color de fondo: se ve incluso con la
 * pantalla lavada por el sol, cuando los fondos tenues se vuelven todos el
 * mismo blanco. Misma logica que el glifo del boton.
 */
export function Tarjeta({
  children,
  estado = 'neutro',
  etiqueta,
}: {
  children: ReactNode;
  estado?: Estado;
  etiqueta?: string;
}) {
  const { estilos } = useTema();
  const p = PALETA[estado];

  return (
    <View
      style={[
        estilos.tarjeta,
        estado !== 'neutro' && {
          borderLeftWidth: grosor.acento,
          borderLeftColor: p.linea,
          backgroundColor: p.fondo,
        },
      ]}
    >
      {etiqueta ? <Text style={estilos.etiqueta}>{etiqueta}</Text> : null}
      {children}
    </View>
  );
}

/**
 * Pastilla de estado. Para lo que se lee de un vistazo: cuantos registros
 * quedan por subir, si hay red, si la jornada esta abierta.
 *
 * Cuando el contenido es un numero usa `Cifra`, para que dos pastillas en
 * columna alineen sus digitos.
 */
export function Pastilla({
  texto,
  estado = 'neutro',
  numero,
}: {
  texto: string;
  estado?: Estado;
  numero?: number;
}) {
  const { t } = useTema();
  const p = PALETA[estado];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: espacio.xs,
        paddingHorizontal: espacio.sm,
        paddingVertical: espacio.xs,
        borderRadius: radio.pastilla,
        borderWidth: grosor.hairline,
        borderColor: p.linea,
        backgroundColor: p.fondo,
      }}
    >
      {numero !== undefined ? (
        <Cifra
          valor={numero}
          tamano="menor"
          tono={
            estado === 'pendiente'
              ? 'aviso'
              : estado === 'listo'
                ? 'exito'
                : estado === 'error'
                  ? 'peligro'
                  : estado === 'accion'
                    ? 'primario'
                    : 'suave'
          }
        />
      ) : null}
      <Text
        style={{
          fontFamily: fuente.cuerpoFuerte,
          fontSize: t(tipo.menor),
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: p.texto,
        }}
      >
        {texto}
      </Text>
    </View>
  );
}
