import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Text, ToastAndroid, View } from 'react-native';

import { ErrorJornada } from '@/datos';
import {
  ETIQUETA_CONDICION,
  LARGO_MAX_COMENTARIO_NO_COBRADA,
  porAtender,
} from '@/datos/notas-asignadas-reglas';
import { ErrorNotaNoCobrada } from '@/datos/repositorios/notas-asignadas';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { crearGuardiaComentario, despuesDeContinuar, validarComentario } from '@/estado/notas-asignadas';
import { useJawa } from '@/estado/proveedor-jawa';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra, pesos } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/** Aviso breve al salir (como la visita sin venta). En otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.LONG);
  else Alert.alert(texto);
}

/**
 * La pantalla de la nota (spec 2026-11-13, regla 11): las notas asignadas de
 * hoy que siguen por atender, con **Cobrar** o **Continuar sin cobrar**
 * (comentario obligatorio). Llega desde la ficha o al tocar "Vender"
 * (`siguiente = 'venta'`). Toda decision esta en `estado/notas-asignadas.ts`.
 */
export default function PantallaNotasAsignadas() {
  const { clienteId, siguiente: siguienteParam } = useLocalSearchParams<{
    clienteId: string;
    siguiente?: string;
  }>();
  const siguiente = siguienteParam === 'venta' ? 'venta' : null;
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  // Se relee al volver de cobrar: grabar no publica un cambio de catalogo.
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  const notas = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    return datos.notasAsignadas.deHoyDelCliente(clienteId);
  }, [datos, clienteId, vueltas, versionCatalogos]);
  const pendientes = porAtender(notas);

  const [comentando, setComentando] = useState(false);
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Doble toque: cada `registrarNoCobrada` crea una fila nueva. Tras grabar se
  // queda cerrada; el estado deshabilita el boton.
  const [guardia] = useState(() => crearGuardiaComentario());
  const [guardado, setGuardado] = useState(false);

  const cliente = datos.catalogos.obtenerCliente(clienteId);
  if (!cliente || !vendedor) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        <Text style={estilos.textoSuave}>Sincroniza y vuelve a abrir su ficha.</Text>
      </Pantalla>
    );
  }
  const vendedorId = vendedor.id;

  const errorComentario = validarComentario(comentario);
  const largo = comentario.trim().length;

  /** A donde se va al terminar, con las notas como estan AHORA (releidas). */
  function seguir() {
    const destino = despuesDeContinuar(datos.notasAsignadas.deHoyDelCliente(clienteId), siguiente);
    if (destino.tipo === 'venta') {
      router.replace({ pathname: '/(jornada)/operacion/[clienteId]/venta', params: { clienteId } });
      return;
    }
    if (destino.motivo) avisar(destino.motivo);
    router.back();
  }

  function cobrar() {
    const primera = pendientes[0];
    router.push({
      pathname: '/(jornada)/operacion/[clienteId]/cobranza',
      params: primera ? { clienteId, notaId: primera.ventaNotaId } : { clienteId },
    });
  }

  function guardar() {
    setError(null);
    if (errorComentario !== null) {
      setError(errorComentario);
      return;
    }
    try {
      // Un solo comentario para todas las de esta vez: una fila por nota (regla 11).
      const hecho = guardia.intentar(() => {
        for (const n of pendientes) {
          datos.notasAsignadas.registrarNoCobrada({
            vendedorId,
            clienteId,
            ventaNotaId: n.ventaNotaId,
            comentario,
          });
        }
        return true;
      });
      if (hecho === null) return;
      setGuardado(true);
      avisar('Comentario guardado');
      seguir();
    } catch (e) {
      setError(
        e instanceof ErrorNotaNoCobrada || e instanceof ErrorJornada
          ? e.message
          : 'No se pudo guardar el comentario. Intenta de nuevo.',
      );
    }
  }

  if (pendientes.length === 0) {
    // Ya se cobraron (o la oficina las quito): nada que atender aqui.
    return (
      <Pantalla titulo="Notas asignadas por cobrar" subtitulo={cliente.nombre}>
        <Tarjeta estado="listo" etiqueta="Notas asignadas por cobrar">
          <Text style={estilos.textoTarjeta}>No quedan notas asignadas por atender hoy.</Text>
        </Tarjeta>
        <Boton
          etiqueta={siguiente === 'venta' ? 'Seguir' : 'Volver al cliente'}
          glifo={siguiente === 'venta' ? '→' : '←'}
          onPress={seguir}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      </Pantalla>
    );
  }

  return (
    <Pantalla
      formulario
      titulo="Notas asignadas por cobrar"
      subtitulo={`${cliente.nombre} · la oficina te pidió cobrarlas hoy`}
    >
      <Tarjeta estado="pendiente" etiqueta="Notas asignadas por cobrar">
        {pendientes.map((n) => {
          const condicion = ETIQUETA_CONDICION[n.condicion];
          return (
            <View key={n.asignacionId} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
              <Text style={estilos.textoTarjeta}>
                <Cifra valor={n.folio} /> · {n.fecha} · debe <Cifra valor={pesos(n.saldoCentavos)} />
                {n.diasAtraso > 0 ? (
                  <>
                    {' '}
                    · <Cifra valor={String(n.diasAtraso)} /> {n.diasAtraso === 1 ? 'día' : 'días'} de atraso
                  </>
                ) : null}
              </Text>
              {condicion ? <Pastilla texto={condicion} estado="pendiente" /> : null}
              {n.comentadaHoy ? <Text style={estilos.textoSuave}>Ya dejaste un comentario hoy.</Text> : null}
            </View>
          );
        })}
      </Tarjeta>

      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}

      <View style={[estilos.filaAcciones, { marginTop: espacio.md }]}>
        <Boton etiqueta="Cobrar" deshabilitado={!menu.operacionesHabilitadas} onPress={cobrar} />
        <Boton
          etiqueta="Continuar sin cobrar"
          tono="neutra"
          deshabilitado={!menu.operacionesHabilitadas || comentando}
          onPress={() => setComentando(true)}
        />
      </View>

      {comentando ? (
        <>
          <Campo
            etiqueta="Por qué no te pagó (obligatorio)"
            value={comentario}
            onChangeText={setComentario}
            placeholder="Lo que te dijo el cliente"
            maxLength={LARGO_MAX_COMENTARIO_NO_COBRADA}
            multiline
            invalido={error !== null && errorComentario !== null}
            ayuda={`${largo}/${LARGO_MAX_COMENTARIO_NO_COBRADA}`}
          />
          {error ? <Text style={estilos.error}>{error}</Text> : null}
          <Boton
            etiqueta="Guardar"
            glifo="✓"
            deshabilitado={errorComentario !== null || !menu.operacionesHabilitadas || guardado}
            onPress={guardar}
            estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
          />
        </>
      ) : null}
    </Pantalla>
  );
}
