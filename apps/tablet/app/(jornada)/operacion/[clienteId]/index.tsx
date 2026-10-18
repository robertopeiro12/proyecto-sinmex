import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, Text, View } from 'react-native';

import type { SyncEstado } from '@/datos/tipos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { estadoSubida, pastillaAlta, urlMapa, urlTelefono } from '@/estado/ruta-del-dia';
import { pastillaVisita } from '@/estado/visita';
import { fotoParaFicha, uriFotoCliente } from '@/fotos/descarga';
import { rutaCacheFotoCliente } from '@/fotos/expo';
import { Boton } from '@/ui/boton';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra, pesos } from '@/ui/cifra';
import { formatearHora } from '@/ui/momento';
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
  const { ultimaSincronizacion, descargarFotoCliente } = useSesion();
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
      visitas: datos.visitas.delDia(clienteId),
      notas: datos.catalogos.notasPendientesDe(clienteId).filter((n) => n.saldo_centavos > 0),
      // Con las mismas dependencias: una venta recien grabada apaga la bienvenida del prospecto.
      promociones: datos.promociones.aplicablesPara(clienteId),
      // T-75 (D4): el estado del alta cambia cuando el push termina (`ultimaSincronizacion`).
      alta: pastillaAlta(datos.prospectos.porId(clienteId)),
    };
  }, [datos, clienteId, vueltas, ultimaSincronizacion, versionCatalogos]);

  const cliente = datos.catalogos.obtenerCliente(clienteId);

  // T-39 (D9): la foto del servidor. La de ESTA tablet gana; si no, la copia en
  // cache, y si falta o es mas vieja que `foto_subida_en` se baja UNA vez por
  // apertura. Sin red sigue diciendo "sin foto", como antes. (Los hooks van
  // antes del `return` de "Cliente no encontrado".)
  const rutaCache = useMemo(() => rutaCacheFotoCliente(clienteId), [clienteId]);
  const cacheSubidaEn = cliente?.foto_cache_subida_en ?? null;
  const subidaEnServidor = cliente?.foto_subida_en ?? null;
  const decision = fotoParaFicha({
    fotoLocal: cliente ? datos.prospectos.fotoLocalDe(cliente) : null,
    fotoSubidaEn: subidaEnServidor,
    cacheSubidaEn,
    // Con `?v=`: la foto nueva cae en la misma ruta y la cache de imagenes de
    // Android se indexa por URI; sin version seguiria pintando la vieja.
    uriCache: cacheSubidaEn !== null ? uriFotoCliente(rutaCache, cacheSubidaEn) : rutaCache,
  });
  const [fotoBajada, setFotoBajada] = useState<string | null>(null);
  // Que version ya se pidio en esta apertura: un fallo (sin red, 401) no se
  // reintenta en cada render ni al volver de vender; espera a la siguiente apertura.
  const fotoPedida = useRef<string | null>(null);
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);
  useEffect(() => {
    if (!decision.descargar || subidaEnServidor === null) return;
    if (fotoPedida.current === subidaEnServidor) return;
    fotoPedida.current = subidaEnServidor;
    void descargarFotoCliente(clienteId, subidaEnServidor).then((uri) => {
      if (montada.current && uri) setFotoBajada(uri);
    });
  }, [clienteId, subidaEnServidor, decision.descargar, descargarFotoCliente]);

  if (!cliente) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        <Text style={estilos.textoSuave}>
          Puede que lo hayan dado de alta después de tu última sincronización.
        </Text>
      </Pantalla>
    );
  }

  const esProspecto = cliente.tipo === 'prospecto';
  const alta = esProspecto ? hoy.alta : null;
  const telefono = urlTelefono(cliente.telefono);
  const mapa = urlMapa(cliente);
  const foto = fotoBajada ?? decision.uri;
  const params = { clienteId };

  // Lo mas grave manda: un error sobre "falta subir", y "falta subir" sobre "todo subido".
  const estadoVentas: Estado = hoy.ventas.some((v) => v.sync_estado === 'error')
    ? 'error'
    : hoy.ventas.some((v) => v.sync_estado !== 'sincronizado')
      ? 'pendiente'
      : hoy.ventas.length > 0
        ? 'listo'
        : 'neutro';
  // Lo mas grave manda, como en "Ventas de hoy" (T-39, D8).
  const estadoVisitas: Estado = estadoSubida(hoy.visitas.map((v) => v.sync_estado)) ?? 'neutro';

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
      subtitulo={`${esProspecto ? 'Prospecto · ' : ''}${
        cliente.encargado ? `Atiende ${cliente.encargado}` : 'Sin encargado registrado'
      }`}
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
          descripcion={
            esProspecto
              ? 'Solo regalo de bienvenida: el prospecto no tiene lista de precios'
              : 'Capturar cantidades; el total se calcula con el precio del cliente'
          }
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/venta', params }}
          deshabilitado={!menu.operacionesHabilitadas}
          destacada
        />
        {/* T-75 (D6): un prospecto no tiene notas ni inventario que ajustar; la conversion es del portal. */}
        {esProspecto ? null : (
          <BotonMenu
            titulo="Cobrar"
            descripcion="Cobrar o abonar una nota pendiente"
            destino={{ pathname: '/(jornada)/operacion/[clienteId]/cobranza', params }}
            deshabilitado={!menu.operacionesHabilitadas}
          />
        )}
        <BotonMenu
          titulo="Visita"
          descripcion="Visita sin venta: por qué no compró, con hora y ubicación"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/visita-sin-venta', params }}
          deshabilitado={!menu.operacionesHabilitadas}
        />
      </View>

      {/* Secundario: sigue aqui hasta que T-27/T-31 den a la entrada del menu una
          pantalla real (hoy abre un "pendiente"); entonces se quita. */}
      {esProspecto ? null : (
        <View style={[estilos.rejilla, { marginTop: espacio.sm }]}>
          <BotonMenu
            titulo="Merma, promoción, consumo y gasto"
            descripcion="Registros de campo que afectan el inventario y el corte"
            destino={{ pathname: '/(jornada)/operacion/[clienteId]/registros', params }}
            deshabilitado={!menu.operacionesHabilitadas}
          />
        </View>
      )}

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
        {alta !== null ? (
          <>
            <Pastilla texto={alta.texto} estado={alta.estado} />
            {alta.detalle ? <Text style={estilos.textoSuave}>{alta.detalle}</Text> : null}
          </>
        ) : null}
      </Tarjeta>

      {esProspecto ? null : (
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
      )}

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

      {/* T-39 (D8): cada visita con su motivo, hora y subida. La rechazada trae su motivo. */}
      <Tarjeta estado={estadoVisitas} etiqueta="Visitas de hoy">
        {hoy.visitas.length === 0 ? (
          <Text style={estilos.textoSuave}>Sin visitas registradas hoy.</Text>
        ) : (
          hoy.visitas.map((v) => {
            const p = pastillaVisita(v);
            return (
              <View key={v.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
                <Text style={estilos.textoTarjeta}>
                  {v.motivo_nombre} · <Cifra valor={formatearHora(v.visitada_en)} />
                </Text>
                <Pastilla texto={p.texto} estado={p.estado} />
                {p.detalle ? <Text style={estilos.error}>{p.detalle}</Text> : null}
              </View>
            );
          })
        )}
      </Tarjeta>

      {esProspecto ? null : (
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
      )}

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
