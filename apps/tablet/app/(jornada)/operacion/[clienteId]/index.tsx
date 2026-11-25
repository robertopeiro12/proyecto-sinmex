import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, Text, View } from 'react-native';

import { motivoBloqueoVenta, porAtender } from '@/datos/notas-asignadas-reglas';
import type { SyncEstado } from '@/datos/tipos';
import { TEXTO_CANDADO } from '@/estado/empezar-ruta';
import { firmaPorSubir } from '@/estado/firma';
import { accionesCliente, TITULO_MERMA_Y_CAMBIOS } from '@/estado/hoja-cliente';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { ETIQUETA_TIPO_MOVIMIENTO, pastillaMovimiento, resumenMovimiento } from '@/estado/movimiento';
import { etiquetaCondicionPendiente, notaParaCobrar, venderDesdeFicha } from '@/estado/notas-asignadas';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { estadoSubida, pastillaAlta, urlMapa, urlTelefono } from '@/estado/ruta-del-dia';
import { pastillaVisita } from '@/estado/visita';
import { fotoParaFicha, uriFotoCliente } from '@/fotos/descarga';
import { rutaCacheFotoCliente } from '@/fotos/expo';
import { Boton } from '@/ui/boton';
import { Cifra, pesos } from '@/ui/cifra';
import { Icono } from '@/ui/icono';
import type { NombreIcono } from '@/ui/iconos';
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
 * Un boton de la hoja (maqueta 7): icono, nombre y, debajo, su nota corta.
 * `principal` lo pinta destacado y a lo ancho (Cobrar con asignada por atender).
 * Apagado se atenua como `Boton` inactivo (0.35) y no navega.
 */
function BotonAccion({
  titulo,
  icono,
  nota,
  destino,
  habilitado,
  principal = false,
}: {
  titulo: string;
  icono: NombreIcono;
  nota: string | null;
  destino: Href;
  habilitado: boolean;
  principal?: boolean;
}) {
  const { dispositivo, t } = useTema();
  return (
    <Pressable
      onPress={() => {
        if (habilitado) router.push(destino);
      }}
      disabled={!habilitado}
      accessibilityRole="button"
      accessibilityLabel={nota ? `${titulo}. ${nota}` : titulo}
      accessibilityState={{ disabled: !habilitado }}
      style={({ pressed }) => [
        {
          flexGrow: 1,
          flexBasis: principal ? '100%' : '45%',
          minHeight: Math.max(dispositivo.tactil + espacio.lg, 80),
          justifyContent: 'center',
          gap: espacio.xs,
          padding: espacio.md,
          borderRadius: radio.medio,
          borderWidth: grosor.fuerte,
          borderColor: principal ? colores.primario : colores.bordeFuerte,
          backgroundColor: principal ? colores.primarioTenue : colores.superficie,
        },
        pressed && habilitado && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
        !habilitado && { opacity: 0.35 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.sm }}>
        <Icono nombre={icono} tamano={24} color={principal ? colores.primario : colores.tinta} />
        <Text
          style={{
            // Sin esto el titulo no se ajusta al boton y se sale (D3, "Merma y cambios").
            flexShrink: 1,
            fontFamily: fuente.tituloMedio,
            fontSize: t(tipo.subtitulo),
            color: principal ? colores.primario : colores.tinta,
          }}
        >
          {titulo}
        </Text>
      </View>
      {nota ? (
        <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.menor), color: colores.tintaSuave }}>
          {nota}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Hoja del cliente (rediseño, pieza 1; spec §6, maqueta 7). Sube sobre la Ruta
 * (`formSheet` en `_layout.tsx`): nombre, encargado y su telefono, "Ir" (Maps)
 * y los botones Cobrar / Vender / Visita / Merma. El recado de la oficina y las
 * notas asignadas por atender se quedan a la vista; lo demas que tenia la ficha
 * (T-37, D16) va plegado en "Ver más", con la misma logica.
 */
export default function FichaCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, jornada, versionCatalogos } = useJawa();
  const { vendedor, ultimaSincronizacion, descargarFotoCliente } = useSesion();
  const { estilos, t } = useTema();
  const [verFoto, setVerFoto] = useState(false);
  const [verMas, setVerMas] = useState(false);
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
      // T-27 pieza 2: la merma registrada con este cliente hoy.
      movimientos: datos.movimientos.delDiaDelCliente(clienteId),
      notas: datos.catalogos.notasPendientesDe(clienteId).filter((n) => n.saldo_centavos > 0),
      // Con las mismas dependencias: una venta recien grabada apaga la bienvenida del prospecto.
      promociones: datos.promociones.aplicablesPara(clienteId),
      // T-75 (D4): el estado del alta cambia cuando el push termina (`ultimaSincronizacion`).
      alta: pastillaAlta(datos.prospectos.porId(clienteId)),
      // Notas asignadas de hoy (spec 2026-11-13): se releen al volver de cobrar o
      // de "Continuar sin cobrar" (`registrarNoCobrada` no publica cambio).
      asignadas: datos.notasAsignadas.deHoyDelCliente(clienteId),
      recado: datos.rutas.recadoDeHoy(clienteId),
    };
  }, [datos, clienteId, vueltas, ultimaSincronizacion, versionCatalogos]);

  // El mismo candado de la Ruta (sin ruta empezada o sin inventario aceptado):
  // la Ruta ya no abre al cliente, pero una ruta profunda si podria.
  const candado = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    void ultimaSincronizacion;
    return vendedor ? datos.cargas.candadoDeHoy(vendedor.id, jornada) : null;
  }, [datos, vendedor, jornada, vueltas, versionCatalogos, ultimaSincronizacion]);

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
    void descargarFotoCliente(clienteId, subidaEnServidor)
      .then((uri) => {
        if (montada.current && uri) setFotoBajada(uri);
      })
      .catch(() => {
        // Cualquier fallo de la descarga se queda como "sin foto".
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

  // Notas asignadas (spec 2026-11-13): todo sale de una sola lectura.
  const asignadasConSaldo = hoy.asignadas.filter((n) => n.saldoCentavos > 0);
  const asignadasPorAtender = porAtender(hoy.asignadas);
  const motivoVenta = motivoBloqueoVenta(hoy.asignadas);
  // Spec §6: Vender se apaga con la condicion sin cumplir (`accionesCliente`);
  // el destino sigue siendo el de la ficha vieja (una asignada sin condicion
  // pasa primero por la pantalla de la nota).
  const vender = venderDesdeFicha(hoy.asignadas);
  const destinoVender =
    vender.destino.tipo === 'notas'
      ? ({
          pathname: '/(jornada)/operacion/[clienteId]/notas-asignadas',
          params: { clienteId, siguiente: vender.destino.siguiente },
        } as const)
      : ({ pathname: '/(jornada)/operacion/[clienteId]/venta', params } as const);

  const acciones = accionesCliente({
    asignadas: hoy.asignadas,
    notasConSaldo: hoy.notas.length,
    esProspecto,
    operacionesHabilitadas: menu.operacionesHabilitadas,
    candado,
  });
  // Con candado o con el dia cerrado todo se apaga; Cobrar y "Continuar sin
  // cobrar" siguen la misma regla que Visita.
  const operable = acciones.visita.habilitado;
  const avisoCandado =
    candado === null
      ? null
      : candado.tipo === 'empezar'
        ? 'Empieza tu ruta para atender clientes'
        : TEXTO_CANDADO[candado.tipo].titulo;
  // La primera por atender o, si no hay, la que aun detiene la venta (abono
  // parcial a una que debe liquidar); sin ninguna, cobranza sin preseleccion.
  const notaCobrar = notaParaCobrar(hoy.asignadas);
  const destinoCobrar: Href =
    notaCobrar !== null
      ? { pathname: '/(jornada)/operacion/[clienteId]/cobranza', params: { clienteId, notaId: notaCobrar } }
      : { pathname: '/(jornada)/operacion/[clienteId]/cobranza', params };
  const botonCobrar = acciones.cobrar?.visible ? (
    <BotonAccion
      titulo="Cobrar"
      icono="cobrar"
      nota={acciones.cobrar.nota}
      destino={destinoCobrar}
      habilitado={operable}
      principal={acciones.cobrar.principal}
    />
  ) : null;

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
  const estadoMovimientos: Estado = estadoSubida(hoy.movimientos.map((m) => m.sync_estado)) ?? 'neutro';

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
    <Pantalla titulo={cliente.nombre} subtitulo={esProspecto ? 'Prospecto' : undefined}>
      {/* Maqueta 7: encargado con su telefono (toca → marcador) y "Ir" (Maps). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.md, marginBottom: espacio.md }}>
        <View style={{ flex: 1, gap: espacio.xs }}>
          <Text style={estilos.etiqueta}>Encargado</Text>
          <Text
            style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}
            numberOfLines={2}
          >
            {cliente.encargado || 'Sin encargado registrado'}
          </Text>
          {telefono ? (
            <Pressable
              onPress={() => abrir(telefono, 'el marcador')}
              accessibilityRole="link"
              accessibilityLabel={`Llamar al ${cliente.telefono}`}
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.xs }}
            >
              <Icono nombre="telefono" tamano={18} color={colores.primario} />
              <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.cuerpo), color: colores.primario }}>
                {cliente.telefono}
              </Text>
            </Pressable>
          ) : (
            <Text style={estilos.textoSuave}>Sin teléfono</Text>
          )}
        </View>
        <Boton
          etiqueta="Ir"
          icono="mapa"
          tono="neutra"
          ancho="ajustado"
          deshabilitado={mapa === null}
          onPress={() => abrir(mapa, 'Maps')}
        />
      </View>

      {/* Es un aviso, no un detalle: se queda arriba de los botones. */}
      {hoy.recado ? (
        <Tarjeta estado="accion" etiqueta="Mensaje de la oficina">
          <Text style={estilos.textoTarjeta}>{hoy.recado}</Text>
        </Tarjeta>
      ) : null}

      {avisoCandado ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.sm, marginBottom: espacio.sm }}>
          <Icono nombre="candado" tamano={18} color={colores.aviso} />
          <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.cuerpo), color: colores.aviso }}>
            {avisoCandado}
          </Text>
        </View>
      ) : null}

      {menu.avisoDiaCerrado ? (
        <Tarjeta estado="listo" etiqueta="Día cerrado">
          <Text style={estilos.textoTarjeta}>{menu.avisoDiaCerrado}</Text>
        </Tarjeta>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm, marginBottom: espacio.md }}>
        {acciones.cobrar?.principal ? botonCobrar : null}
        <BotonAccion
          titulo="Vender"
          icono="vender"
          nota={acciones.vender.nota}
          destino={destinoVender}
          habilitado={acciones.vender.habilitado}
        />
        {acciones.cobrar?.principal ? null : botonCobrar}
        <BotonAccion
          titulo="Visita"
          icono="visita"
          nota="sin venta"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/visita-sin-venta', params }}
          habilitado={acciones.visita.habilitado}
        />
        {/* T-27 pieza 2 (D2): la merma del cliente; desde la pieza 4 del rediseño
            tambien los cambios. Tambien al prospecto: pudo recibir producto
            dañado en su regalo de bienvenida. */}
        <BotonAccion
          titulo={TITULO_MERMA_Y_CAMBIOS}
          icono="merma"
          nota={null}
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/merma', params }}
          habilitado={acciones.merma.habilitado}
        />
      </View>

      {/* Spec 2026-11-13 §6 (pregunta abierta 3 sin resolver): la tarjeta y
          "Continuar sin cobrar" se quedan a la vista, debajo de los botones. */}
      {asignadasConSaldo.length > 0 ? (
        <Tarjeta
          estado={asignadasPorAtender.length > 0 ? 'pendiente' : 'neutro'}
          etiqueta="Notas asignadas por cobrar"
        >
          {asignadasConSaldo.map((n) => {
            // Ya cumplida hoy: no se pinta "Debe ..." (fix T8).
            const condicion = etiquetaCondicionPendiente(n);
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
              </View>
            );
          })}
          {/* Tras "Continuar sin cobrar" con la condicion sin cumplir, aqui queda el motivo. */}
          {motivoVenta ? <Text style={estilos.error}>{motivoVenta}</Text> : null}
          {asignadasPorAtender.length > 0 ? (
            <View style={estilos.filaAcciones}>
              <Boton
                etiqueta="Continuar sin cobrar"
                tono="neutra"
                deshabilitado={!operable}
                onPress={() =>
                  // Con el comentario ya abierto: un toque basta.
                  router.push({
                    pathname: '/(jornada)/operacion/[clienteId]/notas-asignadas',
                    params: { clienteId, comentar: '1' },
                  })
                }
              />
            </View>
          ) : null}
        </Tarjeta>
      ) : null}

      <Pressable
        onPress={() => setVerMas((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: verMas }}
        accessibilityLabel={verMas ? 'Ver menos' : 'Ver más'}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: espacio.xs,
          minHeight: 48,
          marginBottom: espacio.md,
        }}
      >
        <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.cuerpo), color: colores.primario }}>
          {verMas ? 'Ver menos' : 'Ver más'}
        </Text>
      </Pressable>

      {verMas ? (
        <View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm, marginBottom: espacio.md }}>
            {datoTocable(
              'Dirección',
              cliente.domicilio ?? (mapa ? 'Ver ubicación' : 'sin domicilio'),
              mapa ? () => abrir(mapa, 'Maps') : null,
            )}
            {foto ? datoTocable('Foto del lugar', 'Ver foto', () => setVerFoto(true)) : null}
          </View>

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
                  {/* T-73: la firma sube aparte, cuando la venta ya esta arriba. */}
                  {firmaPorSubir(v) ? <Pastilla texto="Firma por subir" estado="pendiente" /> : null}
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

          {/* T-27 pieza 2: la merma (y desde la pieza 4, los cambios) con este cliente, con su subida. No se edita ni se borra (D6). */}
          <Tarjeta estado={estadoMovimientos} etiqueta="Movimientos de hoy">
            {hoy.movimientos.length === 0 ? (
              <Text style={estilos.textoSuave}>Sin merma ni cambios hoy.</Text>
            ) : (
              hoy.movimientos.map((m) => {
                const p = pastillaMovimiento(m);
                return (
                  <View key={m.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
                    <Text style={estilos.textoTarjeta}>
                      {ETIQUETA_TIPO_MOVIMIENTO[m.tipo]} · <Cifra valor={formatearHora(m.registrado_en)} />
                    </Text>
                    {m.motivo_nombre ? <Text style={estilos.textoSuave}>{m.motivo_nombre}</Text> : null}
                    <Text style={estilos.textoSuave}>{resumenMovimiento(m)}</Text>
                    {m.comentario ? <Text style={estilos.textoSuave}>{m.comentario}</Text> : null}
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

        </View>
      ) : null}

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
