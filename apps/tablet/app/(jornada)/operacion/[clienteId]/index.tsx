import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, Text, View } from 'react-native';

import type { SyncEstado } from '@/datos/tipos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { urlMapa, urlTelefono } from '@/estado/ruta-del-dia';
import { Boton } from '@/ui/boton';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra, pesos } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta, type Estado } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

/** Como se le dice al vendedor en que va cada venta. */
const ETIQUETA_SYNC: Record<SyncEstado, string> = {
  pendiente: 'Por subir',
  enviando: 'Subiendo',
  sincronizado: 'Sincronizada',
  error: 'Con error',
};

const ESTADO_SYNC: Record<SyncEstado, Estado> = {
  pendiente: 'pendiente',
  enviando: 'pendiente',
  sincronizado: 'listo',
  error: 'error',
};

/** Abre el marcador o Maps; si el equipo no puede, lo dice en vez de fallar callado. */
function abrir(url: string | null, queAbre: string) {
  if (!url) return;
  Linking.openURL(url).catch(() =>
    Alert.alert(`No se pudo abrir ${queAbre}`, 'Esta tablet no tiene una aplicación para eso.'),
  );
}

/**
 * Ficha del cliente (T-37, D16): sus datos tocables, las tres acciones del dia
 * y lo que debe y lo que ya paso hoy.
 */
export default function FichaCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, jornada, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos, t } = useTema();
  const [verFoto, setVerFoto] = useState(false);
  const menu = estadoMenuJornada(jornada);

  // Se relee al volver de vender o cobrar (`useFocusEffect`): grabar no mueve
  // `datos` y `router.back()` no vuelve a montar la pantalla.
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  const hoy = useMemo(() => {
    void vueltas;
    void ultimaSincronizacion;
    void versionCatalogos;
    return {
      ventas: datos.ventas.delDia(clienteId),
      cobros: datos.cobranzas.delDia(clienteId),
      notas: datos.catalogos.notasPendientesDe(clienteId).filter((n) => n.saldo_centavos > 0),
      // Con las mismas dependencias: una venta recien grabada apaga la bienvenida del prospecto.
      promociones: datos.promociones.aplicablesPara(clienteId),
    };
  }, [datos, clienteId, vueltas, ultimaSincronizacion, versionCatalogos]);

  const cliente = datos.catalogos.obtenerCliente(clienteId);

  if (!cliente) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        <Text style={estilos.textoSuave}>
          Puede que lo hayan dado de alta después de tu última sincronización.
        </Text>
      </Pantalla>
    );
  }

  const telefono = urlTelefono(cliente.telefono);
  const mapa = urlMapa(cliente);
  // D8: solo la foto que tomo ESTA tablet; la del servidor llega en la pieza 3.
  const foto = datos.prospectos.fotoLocalDe(cliente);
  const params = { clienteId };

  // Lo mas grave manda: un error sobre "falta subir", y "falta subir" sobre "todo subido".
  const estadoVentas: Estado = hoy.ventas.some((v) => v.sync_estado === 'error')
    ? 'error'
    : hoy.ventas.some((v) => v.sync_estado !== 'sincronizado')
      ? 'pendiente'
      : hoy.ventas.length > 0
        ? 'listo'
        : 'neutro';

  const datoTocable = (etiqueta: string, valor: string, onPress: (() => void) | null) => (
    <Pressable
      key={etiqueta}
      disabled={onPress === null}
      onPress={onPress ?? undefined}
      accessibilityRole={onPress ? 'link' : 'text'}
      accessibilityLabel={`${etiqueta}: ${valor}`}
      style={({ pressed }) => [
        {
          flexGrow: 1,
          flexBasis: 220,
          padding: espacio.md,
          gap: espacio.xs,
          borderRadius: radio.medio,
          borderWidth: grosor.fuerte,
          borderColor: onPress ? colores.bordeFuerte : colores.borde,
          backgroundColor: colores.superficie,
        },
        pressed && { backgroundColor: colores.primarioTenue },
      ]}
    >
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <Text
        numberOfLines={2}
        style={{
          fontFamily: fuente.cuerpoFuerte,
          fontSize: t(tipo.destacado),
          color: onPress ? colores.primario : colores.tintaSuave,
        }}
      >
        {valor}
      </Text>
    </Pressable>
  );

  return (
    <Pantalla
      titulo={cliente.nombre}
      subtitulo={cliente.encargado ? `Atiende ${cliente.encargado}` : 'Sin encargado registrado'}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm }}>
        {datoTocable(
          'Teléfono',
          cliente.telefono || 'sin teléfono',
          telefono ? () => abrir(telefono, 'el marcador') : null,
        )}
        {datoTocable(
          'Dirección',
          cliente.domicilio ?? (mapa ? 'Ver ubicación' : 'sin domicilio'),
          mapa ? () => abrir(mapa, 'Maps') : null,
        )}
        {foto ? datoTocable('Foto del lugar', 'Ver foto', () => setVerFoto(true)) : null}
      </View>

      <View style={[estilos.rejilla, { marginTop: espacio.md }]}>
        <BotonMenu
          titulo="Vender"
          descripcion="Capturar cantidades; el total se calcula con el precio del cliente"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/venta', params }}
          deshabilitado={!menu.operacionesHabilitadas}
          destacada
        />
        <BotonMenu
          titulo="Cobrar"
          descripcion="Cobrar o abonar una nota pendiente"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/cobranza', params }}
          deshabilitado={!menu.operacionesHabilitadas}
        />
        <BotonMenu
          titulo="Visita"
          descripcion="Visita sin venta (pendiente T-39)"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/visita-sin-venta', params }}
          deshabilitado={!menu.operacionesHabilitadas}
        />
      </View>

      {/* Secundario: sigue aqui hasta que T-27/T-31 den a la entrada del menu una
          pantalla real (hoy abre un "pendiente"); entonces se quita. */}
      <View style={[estilos.rejilla, { marginTop: espacio.sm }]}>
        <BotonMenu
          titulo="Merma, promoción, consumo y gasto"
          descripcion="Registros de campo que afectan el inventario y el corte"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/registros', params }}
          deshabilitado={!menu.operacionesHabilitadas}
        />
      </View>

      {menu.avisoDiaCerrado ? (
        <Tarjeta estado="listo" etiqueta="Día cerrado">
          <Text style={estilos.textoTarjeta}>{menu.avisoDiaCerrado}</Text>
        </Tarjeta>
      ) : null}

      {/* T-20 (D5): se crea al cobrar de mas; usarlo es del portal. */}
      {cliente.saldo_favor_centavos > 0 ? (
        <Tarjeta estado="listo" etiqueta="Saldo a favor">
          <Cifra valor={pesos(cliente.saldo_favor_centavos)} tamano="destacado" tono="exito" />
          <Text style={estilos.textoSuave}>Lo aplica la oficina desde el portal.</Text>
        </Tarjeta>
      ) : null}

      {/* T-74 (D11): lo que le toca hoy, en lenguaje llano; la venta lo calcula sola. */}
      <Tarjeta estado={hoy.promociones.length > 0 ? 'listo' : 'neutro'} etiqueta="Promociones">
        {hoy.promociones.length === 0 ? (
          <Text style={estilos.textoSuave}>Sin promoción.</Text>
        ) : (
          hoy.promociones.map((p) => (
            <Text key={p.id} style={estilos.textoTarjeta}>
              {p.texto}
              {p.audiencia === 'prospecto' ? ' (primera venta)' : ''}
            </Text>
          ))
        )}
      </Tarjeta>

      <Tarjeta estado={hoy.notas.length > 0 ? 'pendiente' : 'neutro'} etiqueta="Notas pendientes">
        {hoy.notas.length === 0 ? (
          <Text style={estilos.textoSuave}>No debe nada.</Text>
        ) : (
          hoy.notas.map((n) => (
            <Text key={n.id} style={estilos.textoTarjeta}>
              <Cifra valor={n.folio} /> · {n.fecha} · debe <Cifra valor={pesos(n.saldo_centavos)} />
            </Text>
          ))
        )}
      </Tarjeta>

      <Tarjeta estado={estadoVentas} etiqueta="Ventas de hoy">
        {hoy.ventas.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no le has vendido hoy.</Text>
        ) : (
          hoy.ventas.map((v) => (
            <View key={v.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
              <Text style={estilos.textoTarjeta}>
                <Cifra valor={v.folio} /> · <Cifra valor={pesos(v.monto_total_centavos)} /> ·{' '}
                {v.contado_credito === 'contado' ? 'contado' : 'crédito'}
              </Text>
              <Pastilla texto={ETIQUETA_SYNC[v.sync_estado]} estado={ESTADO_SYNC[v.sync_estado]} />
              {v.sync_estado === 'error' && v.sync_error ? (
                <Text style={estilos.error}>{v.sync_error}</Text>
              ) : null}
            </View>
          ))
        )}
      </Tarjeta>

      <Tarjeta etiqueta="Cobros de hoy">
        {hoy.cobros.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no le has cobrado hoy.</Text>
        ) : (
          hoy.cobros.map((c) => (
            <View key={c.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
              <Text style={estilos.textoTarjeta}>
                <Cifra valor={pesos(c.monto_centavos)} /> · {c.metodo_pago}
              </Text>
              <Pastilla texto={ETIQUETA_SYNC[c.sync_estado]} estado={ESTADO_SYNC[c.sync_estado]} />
              {c.sync_estado === 'error' && c.sync_error ? (
                <Text style={estilos.error}>{c.sync_error}</Text>
              ) : null}
            </View>
          ))
        )}
      </Tarjeta>

      {foto ? (
        <Modal visible={verFoto} transparent animationType="fade" onRequestClose={() => setVerFoto(false)}>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              padding: espacio.lg,
              gap: espacio.md,
              backgroundColor: 'rgba(25, 20, 16, 0.85)',
            }}
          >
            <Image
              source={{ uri: foto }}
              accessibilityLabel={`Foto del lugar de ${cliente.nombre}`}
              style={{ width: '100%', flex: 1, resizeMode: 'contain' }}
            />
            <Boton etiqueta="Cerrar" tono="neutra" ancho="ajustado" onPress={() => setVerFoto(false)} />
          </View>
        </Modal>
      ) : null}
    </Pantalla>
  );
}
