import { Pressable, Text, View } from 'react-native';

import type { FilaRutaDelDia } from '@/datos/repositorios/rutas';
import {
  type AtendidoFueraDeRuta,
  motivoDeRechazo,
  primeraLineaDomicilio,
  resumenVisitado,
  textoNotasQueTrae,
} from '@/estado/ruta-del-dia';
import { textoEstadoVisitas } from '@/estado/visita';

import { Icono } from './icono';
import { Pastilla, type Estado } from './pantalla';
import { useTema } from './tema';
import { colores, espacio, fuente, grosor, radio, tipo } from './tokens';

/**
 * Una seccion de la ruta en curso (rediseño §4 y §6, maqueta 6): "Por visitar"
 * o "Visitados". Muestra lo que le pasan, en ese orden: quien decide que filas
 * van en cada una es `agruparRutaEnCurso`. El orden es el del portal; ya no se
 * arrastra (se quito el reordenar de T-37, D10).
 */
export function ListaRuta({
  filas,
  visitados,
  numeroDe,
  onTocar,
  onQuitar,
}: {
  filas: readonly FilaRutaDelDia[];
  /** `true` en "Visitados": palomita en vez del numero y el resumen de lo hecho. */
  visitados: boolean;
  /** El lugar fijo del cliente en la ruta viva (no cambia al pasar a Visitados). */
  numeroDe: (clienteId: string) => number;
  onTocar: (clienteId: string) => void;
  onQuitar: (id: string) => void;
}) {
  return (
    <View style={{ gap: espacio.sm }}>
      {filas.map((fila) => (
        <FilaRuta
          key={fila.id}
          fila={fila}
          visitado={visitados}
          numero={numeroDe(fila.cliente_id)}
          onTocar={onTocar}
          onQuitar={onQuitar}
        />
      ))}
    </View>
  );
}

function FilaRuta({
  fila,
  visitado,
  numero,
  onTocar,
  onQuitar,
}: {
  fila: FilaRutaDelDia;
  visitado: boolean;
  numero: number;
  onTocar: (clienteId: string) => void;
  onQuitar: (id: string) => void;
}) {
  const { t } = useTema();
  const conError = fila.sync_estado === 'error';
  const resumen = visitado ? resumenVisitado(fila) : '';
  const estadoVisitas = visitado ? fila.visitas_estado : null;
  const textoVisitas = estadoVisitas ? textoEstadoVisitas(estadoVisitas) : null;
  const etiqueta = [
    visitado ? `${fila.nombre}, visitado` : `${numero}, ${fila.nombre}`,
    resumen || null,
    fila.notas_que_trae > 0 ? textoNotasQueTrae(fila.notas_que_trae) : null,
    textoVisitas ? `visitas ${textoVisitas}` : null,
  ]
    .filter((x) => x !== null)
    .join(', ');

  return (
    <Pressable
      onPress={() => onTocar(fila.cliente_id)}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [
        {
          minHeight: 72,
          flexDirection: 'row',
          alignItems: 'center',
          gap: espacio.md,
          paddingHorizontal: espacio.md,
          paddingVertical: espacio.sm,
          borderRadius: radio.medio,
          borderWidth: grosor.hairline,
          borderColor: colores.borde,
          backgroundColor: visitado ? colores.superficieHundida : colores.superficie,
        },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={{ width: 36, alignItems: 'flex-end' }}>
        {visitado ? (
          <Icono nombre="palomita" tamano={t(tipo.destacado)} color={colores.exito} />
        ) : (
          <Text
            style={{
              fontFamily: fuente.cifraFuerte,
              fontSize: t(tipo.destacado),
              color: colores.tintaSuave,
            }}
          >
            {numero}
          </Text>
        )}
      </View>

      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}
        >
          {fila.nombre}
        </Text>
        {fila.recado ? (
          <Text
            numberOfLines={1}
            accessibilityLabel={`Mensaje de la oficina: ${fila.recado}`}
            style={{ fontFamily: fuente.cuerpoMedio, fontSize: t(tipo.menor), color: colores.primario }}
          >
            {fila.recado}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.cuerpo), color: colores.tintaSuave }}
        >
          {resumen || primeraLineaDomicilio(fila.domicilio)}
        </Text>
        {conError ? (
          // Mismo tratamiento que una venta rechazada: texto rojo bajo la fila.
          <Text
            numberOfLines={1}
            style={{ fontFamily: fuente.cuerpoMedio, fontSize: t(tipo.menor), color: colores.peligro }}
          >
            Rechazado: {fila.sync_error}
          </Text>
        ) : fila.sync_estado === 'pendiente' ? (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fuente.cuerpoMedio, fontSize: t(tipo.menor), color: colores.aviso }}
          >
            Por subir
          </Text>
        ) : null}
        {estadoVisitas === 'error' && fila.visita_error ? (
          <Text
            numberOfLines={2}
            style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.menor), color: colores.peligro }}
          >
            {motivoDeRechazo(fila.visita_error)}
          </Text>
        ) : null}
      </View>

      {estadoVisitas && textoVisitas ? <Pastilla texto={textoVisitas} estado={estadoVisitas} /> : null}
      {fila.notas_que_trae > 0 ? <ContadorNotas notas={fila.notas_que_trae} /> : null}

      {conError ? (
        <BotonChico
          etiqueta="Quitar"
          etiquetaAccesible={`Quitar ${fila.nombre} de la ruta`}
          onPress={() => onQuitar(fila.id)}
        />
      ) : null}
    </Pressable>
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
  const resumen = resumenVisitado(fila);
  return (
    <Pressable
      onPress={() => onTocar(fila.cliente_id)}
      accessibilityRole="button"
      accessibilityLabel={`${fila.nombre}, fuera de ruta, visitado${resumen ? `, ${resumen}` : ''}`}
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
      <Icono nombre="palomita" tamano={t(tipo.destacado)} color={colores.exito} />
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
          {resumen || primeraLineaDomicilio(fila.domicilio)}
        </Text>
      </View>
      {fila.notas_que_trae > 0 ? <ContadorNotas notas={fila.notas_que_trae} /> : null}
    </Pressable>
  );
}

/**
 * Un cliente de la ruta de hoy que la oficina dio de baja y que no tuvo
 * actividad (pieza 6, I-1): atenuado, sin tocar (ninguna operacion se le puede
 * hacer) y fuera de "Por visitar", para que no deje Corte con candado.
 */
export function FilaDadoDeBaja({ fila }: { fila: FilaRutaDelDia }) {
  const { t } = useTema();
  return (
    <View
      accessible
      accessibilityLabel={`${fila.nombre}, dado de baja por la oficina`}
      style={{
        padding: espacio.md,
        gap: espacio.xs,
        borderRadius: radio.medio,
        borderWidth: grosor.hairline,
        borderColor: colores.borde,
        backgroundColor: colores.superficieHundida,
        opacity: 0.6,
      }}
    >
      <Text
        numberOfLines={1}
        style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tintaSuave }}
      >
        {fila.nombre}
      </Text>
      <Text
        numberOfLines={1}
        style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.cuerpo), color: colores.tintaSuave }}
      >
        Dado de baja por la oficina · no cuenta para el corte
      </Text>
    </View>
  );
}

/**
 * Cuantas notas por cobrar trae el vendedor de ese cliente (spec §4): icono de
 * nota y el numero. Quien la pinta ya comprobo que es mayor a cero.
 */
function ContadorNotas({ notas }: { notas: number }) {
  const { t } = useTema();
  return (
    <View
      accessible
      accessibilityLabel={textoNotasQueTrae(notas)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: espacio.xs,
        minHeight: 32,
        paddingHorizontal: espacio.sm,
        borderRadius: radio.pastilla,
        borderWidth: grosor.hairline,
        borderColor: colores.primario,
        backgroundColor: colores.primarioTenue,
      }}
    >
      <Icono nombre="nota" tamano={t(tipo.cuerpo)} color={colores.primario} />
      <Text style={{ fontFamily: fuente.cifraFuerte, fontSize: t(tipo.cuerpo), color: colores.primario }}>
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

/** Un cliente o prospecto con venta de hoy que no esta en la ruta (T-75, D7). */
export function FilaAtendidoFueraDeRuta({
  fila,
  onTocar,
}: {
  fila: AtendidoFueraDeRuta;
  onTocar: (clienteId: string) => void;
}) {
  const { t } = useTema();
  const pastilla = { error: 'con error', pendiente: 'por subir', listo: 'subido' }[fila.estado];
  // `EstadoSubida` es un subconjunto de `Estado`: la pastilla lo recibe tal cual.
  const estado: Estado = fila.estado;
  return (
    <Pressable
      onPress={() => onTocar(fila.cliente_id)}
      accessibilityRole="button"
      accessibilityLabel={`${fila.nombre}, ${fila.esProspecto ? 'prospecto, ' : ''}${fila.soloVisita ? 'visita, ' : ''}atendido fuera de ruta, ${pastilla}`}
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
        },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}
        >
          {fila.nombre}
        </Text>
        <View style={{ flexDirection: 'row', gap: espacio.xs }}>
          {fila.esProspecto ? <Pastilla texto="prospecto" estado="neutro" /> : null}
          {/* T-39 (D8): solo se le visito, sin venta. */}
          {fila.soloVisita ? <Pastilla texto="visita" estado="neutro" /> : null}
          <Pastilla texto={pastilla} estado={estado} />
        </View>
      </View>
    </Pressable>
  );
}
