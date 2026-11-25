import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ErrorCobranza,
  ErrorJornada,
  leerAbonos,
  lineasDelCobro,
  NOMBRE_METODO,
  problemasDeCobro,
  type Cobranza,
  type LineaDeCobro,
  type MetodoPago,
  type NotaPendiente,
} from '@/datos';
import { notaAlFrente, textoOtrasNotas, validarCobro, type OpcionCobro } from '@/estado/cobrar';
import { montoACentavos } from '@/estado/gasto';
import { crearGuardiaRegistro } from '@/estado/movimiento';
import { agruparNotasParaCobrar } from '@/estado/notas-asignadas';
import { useJawa } from '@/estado/proveedor-jawa';
import { textoSaldoPendiente } from '@/estado/venta-pasos';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra, pesos } from '@/ui/cifra';
import { Icono } from '@/ui/icono';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

const METODOS: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'cheque', etiqueta: 'Cheque' },
];

const ETIQUETA_OPCION: Record<OpcionCobro, string> = {
  liquidar: 'Liquidar',
  abonar: 'Abonar',
};

/**
 * Cobrar una nota pendiente (rediseno pieza 2, maqueta 13): la nota al frente
 * (la pedida, la asignada o la mas antigua: `notaAlFrente`), Liquidar o Abonar,
 * el metodo de pago y "Grabar", sin paso de revision. "Otras notas pendientes"
 * abre las demas notas del cliente (asignadas y otras) para poner otra al frente.
 *
 * Sin firma: el cliente firma a mano la nota impresa. La fecha de pago es hoy.
 * El reparto lo hace el repositorio (`datos.cobranzas.registrar`); con Liquidar
 * o un abono menor al saldo todo cae en la nota del frente.
 */
export default function PantallaCobranza() {
  // `notaId`: la nota que la ficha o la venta piden cobrar (`notaParaCobrar`).
  const { clienteId, notaId: notaIdInicial } = useLocalSearchParams<{ clienteId: string; notaId?: string }>();
  const { datos, vendedor, versionCatalogos } = useJawa();
  const { estilos, t } = useTema();
  const insets = useSafeAreaInsets();

  // El dia de trabajo del reloj de la tablet: el de `fecha_operacion`.
  const hoy = datos.deps.reloj.hoy();

  // `versionCatalogos` en las lecturas: grabar un cobro descuenta saldos y el
  // pull los reescribe; sin ella la pantalla no lo veria (defecto 2026-08-23).
  const cliente = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.obtenerCliente(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  const notas = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.notasPendientesDe(clienteId).filter((n) => n.saldo_centavos > 0);
  }, [datos, clienteId, versionCatalogos]);

  // Las asignadas se releen al volver a la pantalla (cobrar no publica cambio de catalogo).
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );
  const asignadas = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    return datos.notasAsignadas.deHoyDelCliente(clienteId);
  }, [datos, clienteId, vueltas, versionCatalogos]);

  /** La nota que el vendedor puso al frente desde "Otras notas"; al inicio, la pedida. */
  const [notaElegida, setNotaElegida] = useState<string | null>(notaIdInicial ?? null);
  const [verOtras, setVerOtras] = useState(false);
  const [opcion, setOpcion] = useState<OpcionCobro>('liquidar');
  const [montoTexto, setMontoTexto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [problemas, setProblemas] = useState<string[]>([]);
  const [grabado, setGrabado] = useState<{ cobro: Cobranza; lineas: LineaDeCobro[]; saldoFavorCentavos: number } | null>(
    null,
  );
  /** Guardia de doble toque: un segundo toque en "Grabar" no graba otro cobro. */
  const [guardia] = useState(() => crearGuardiaRegistro());

  const nota = notaAlFrente(notas, asignadas, notaElegida);
  const grupos = agruparNotasParaCobrar(notas, asignadas);
  const asignadaAlFrente = nota ? grupos.asignadas.find((a) => a.nota.id === nota.id) : undefined;
  const otras = nota ? agruparNotasParaCobrar(notas.filter((n) => n.id !== nota.id), asignadas) : grupos;
  const numOtras = otras.asignadas.length + otras.otras.length;

  /** "Otras notas pendientes" abierta (y el cobro sin grabar). */
  const listaAbierta = verOtras && grabado === null;

  /** Atras: `true` = se atendio aqui (cerrar la lista); `false` = salir. */
  const atras = useCallback((): boolean => {
    if (!listaAbierta) return false;
    setVerOtras(false);
    return true;
  }, [listaAbierta, setVerOtras]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', atras);
      return () => sub.remove();
    }, [atras]),
  );

  const cabecera = (
    <Stack.Screen
      options={{
        headerTitle: () => (
          <View>
            <Text style={{ fontFamily: fuente.tituloMedio, fontSize: t(tipo.subtitulo), color: colores.tinta }}>
              {listaAbierta ? 'Otras notas pendientes' : 'Cobrar'}
            </Text>
            {cliente ? (
              <Text style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.menor), color: colores.tintaSuave }}>
                {cliente.nombre}
              </Text>
            ) : null}
          </View>
        ),
        headerLeft: () => (
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
        ),
      }}
    />
  );

  // Antes de este punto solo hay hooks: se llaman siempre, en el mismo orden.
  if (!cliente || !vendedor) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        {cabecera}
        <Text style={estilos.textoSuave}>
          Puede que lo hayan dado de alta después de tu última sincronización.
        </Text>
      </Pantalla>
    );
  }

  const vendedorId = vendedor.id;
  const nombreCliente = cliente.nombre;

  /* ---------------------------------------------------------------- */
  /* Grabado: el monto y como quedaron las notas                       */
  /* ---------------------------------------------------------------- */

  // Antes que "sin notas": liquidar la unica nota deja `notas` vacio.
  if (grabado) {
    const { cobro, lineas, saldoFavorCentavos } = grabado;
    return (
      <Pantalla subtitulo={`${nombreCliente} · así quedaron sus notas.`}>
        {cabecera}
        <Tarjeta estado="listo" etiqueta="Cobro grabado">
          <Cifra valor={pesos(cobro.monto_centavos)} tamano="grande" />
          <Text style={estilos.textoSuave}>
            En {NOMBRE_METODO[cobro.metodo_pago]} · pagado el {cobro.fecha_pago}
          </Text>
          {lineas.map((l) => (
            <Text key={l.notaId} style={estilos.textoTarjeta}>
              <Cifra valor={pesos(l.montoCentavos)} /> · nota <Cifra valor={l.folio} />{' '}
              {l.saldoDespuesCentavos === 0 ? (
                'pagada'
              ) : (
                <>
                  queda debiendo <Cifra valor={pesos(l.saldoDespuesCentavos)} tono="aviso" />
                </>
              )}
            </Text>
          ))}
          {saldoFavorCentavos > 0 ? (
            <Text style={estilos.textoTarjeta}>
              Saldo a favor del cliente: <Cifra valor={pesos(saldoFavorCentavos)} tono="exito" />
            </Text>
          ) : null}
          <Text style={estilos.textoSuave}>
            Quedó guardado en la tablet y sube solo al sincronizar. Si otra tablet o la oficina ya cobró esa
            nota, el servidor pasa el dinero a las otras notas o al saldo a favor.
          </Text>
        </Tarjeta>
        <Boton
          etiqueta="Volver a la ruta"
          icono="atras"
          onPress={() => router.dismissTo('/(jornada)')}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      </Pantalla>
    );
  }

  /** Lo que se desliza arriba y, si hay, una barra fija abajo. */
  function marco(cuerpo: ReactNode, abajo: ReactNode = null) {
    return (
      <View style={{ flex: 1, backgroundColor: colores.papel }}>
        {cabecera}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[estilos.contenido, { paddingBottom: espacio.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          {cuerpo}
        </ScrollView>
        {abajo}
      </View>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Sin notas                                                         */
  /* ---------------------------------------------------------------- */

  if (nota === null) {
    return marco(
      <Tarjeta etiqueta="Sin notas">
        <Text style={estilos.textoTarjeta}>Este cliente no tiene notas pendientes en la tablet.</Text>
        <Text style={estilos.textoSuave}>Las notas bajan del portal al sincronizar.</Text>
      </Tarjeta>,
    );
  }

  /** Pone otra nota al frente y empieza el cobro de cero (otro saldo). */
  function elegirNota(id: string) {
    setNotaElegida(id);
    setOpcion('liquidar');
    setMontoTexto('');
    setProblemas([]);
    setVerOtras(false);
  }

  /* ---------------------------------------------------------------- */
  /* Otras notas pendientes                                            */
  /* ---------------------------------------------------------------- */

  if (verOtras) {
    return marco(
      <>
        <Text style={[estilos.textoSuave, { marginBottom: espacio.sm }]}>
          Toca la nota que quieres cobrar; queda al frente.
        </Text>
        {otras.asignadas.length > 0 ? <Text style={estilos.seccion}>Asignadas a ti</Text> : null}
        {otras.asignadas.map(({ nota: n, etiqueta }) => (
          <NotaElegible key={n.id} nota={n} condicion={etiqueta} onPress={() => elegirNota(n.id)} />
        ))}
        {otras.otras.length > 0 ? (
          <Text style={estilos.seccion}>
            {otras.asignadas.length > 0 ? 'Otras notas del cliente' : 'Notas del cliente'}
          </Text>
        ) : null}
        {otras.otras.map((n) => (
          <NotaElegible key={n.id} nota={n} onPress={() => elegirNota(n.id)} />
        ))}
      </>,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Cobrar (maqueta 13)                                               */
  /* ---------------------------------------------------------------- */

  const notaFrente: NotaPendiente = nota;
  const saldo = notaFrente.saldo_centavos;
  const abonos = leerAbonos(notaFrente.abonos_json);
  const abonoCentavos = montoACentavos(montoTexto) ?? 0;

  function grabar() {
    const cobro = validarCobro({ opcion, montoTexto, saldoCentavos: saldo });
    const monto = cobro.montoCentavos;
    if (cobro.problemas.length > 0 || monto === null) {
      setProblemas(cobro.problemas);
      return;
    }
    const encontrados = problemasDeCobro({
      notaFecha: notaFrente.fecha,
      montoCentavos: monto,
      metodoPago: metodo,
      fechaPago: hoy,
      hoy,
    });
    if (encontrados.length > 0) {
      setProblemas(encontrados);
      return;
    }
    // Antes de grabar: una nota que queda en 0 sale de `notas` y ya no se
    // encontraria su folio para la pantalla de hecho.
    const reparto = datos.cobranzas.previsualizar(clienteId, notaFrente.id, monto);
    const lineas = reparto ? lineasDelCobro(reparto, notas) : [];
    const saldoFavorCentavos = reparto?.saldoFavorCentavos ?? 0;
    try {
      const registrado = guardia.intentar(() =>
        datos.cobranzas.registrar({
          vendedorId,
          clienteId,
          ventaNotaId: notaFrente.id,
          montoCentavos: monto,
          metodoPago: metodo,
          fechaPago: hoy,
        }),
      );
      // Segundo toque mientras el primero corre: el primero se encarga de todo.
      if (registrado === null) return;
      setProblemas([]);
      setGrabado({ cobro: registrado, lineas, saldoFavorCentavos });
    } catch (e) {
      setProblemas([
        e instanceof ErrorCobranza || e instanceof ErrorJornada
          ? e.message
          : 'No se pudo grabar el cobro. No se guardó nada; intenta de nuevo.',
      ]);
    }
  }

  return marco(
    <>
      <Tarjeta etiqueta={asignadaAlFrente ? 'Nota asignada' : 'Nota pendiente'}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: espacio.xs,
          }}
        >
          <Text style={estilos.textoTarjeta}>
            Nota <Cifra valor={notaFrente.folio} />
            {notaFrente.num_nota ? (
              <>
                {' '}
                · papel <Cifra valor={notaFrente.num_nota} />
              </>
            ) : null}
          </Text>
          {asignadaAlFrente?.etiqueta ? <Pastilla texto={asignadaAlFrente.etiqueta} estado="pendiente" /> : null}
        </View>
        <Dato etiqueta="Fecha" valor={notaFrente.fecha} />
        <Dato etiqueta="Total" valor={pesos(notaFrente.monto_total_centavos)} />
        {abonos.map((a, i) => (
          <Dato
            key={`${a.fecha_pago}-${i}`}
            etiqueta={`Abonado (${a.fecha_pago}, ${NOMBRE_METODO[a.metodo_pago] ?? a.metodo_pago})`}
            valor={pesos(a.monto_centavos)}
          />
        ))}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: espacio.xs,
            paddingTop: espacio.sm,
            borderTopWidth: grosor.fuerte,
            borderTopColor: colores.bordeFuerte,
          }}
        >
          <Text style={estilos.textoTarjeta}>Debe</Text>
          <Cifra valor={pesos(saldo)} tamano="destacado" />
        </View>
      </Tarjeta>

      <Text style={estilos.seccion}>Cobranza</Text>
      <View style={{ flexDirection: 'row', gap: espacio.sm, marginBottom: espacio.md }}>
        {(['liquidar', 'abonar'] as const).map((o) => (
          <Chip
            key={o}
            etiqueta={ETIQUETA_OPCION[o]}
            elegida={opcion === o}
            onPress={() => {
              setProblemas([]);
              setOpcion(o);
            }}
            ancho
          />
        ))}
      </View>

      {opcion === 'liquidar' ? (
        <View style={[estilos.campo, { backgroundColor: colores.superficieHundida, justifyContent: 'center' }]}>
          <Cifra valor={pesos(saldo)} />
        </View>
      ) : (
        <>
          <Campo
            etiqueta="Cuánto abona"
            cifra
            keyboardType="decimal-pad"
            value={montoTexto}
            onChangeText={setMontoTexto}
            placeholder="0.00"
          />
          <Tarjeta estado="pendiente">
            <Text style={estilos.textoTarjeta}>{textoSaldoPendiente(Math.max(0, saldo - abonoCentavos))}</Text>
          </Tarjeta>
        </>
      )}

      <Text style={estilos.seccion}>Método de pago</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm, marginBottom: espacio.md }}>
        {METODOS.map((m) => (
          <Chip key={m.valor} etiqueta={m.etiqueta} elegida={metodo === m.valor} onPress={() => setMetodo(m.valor)} />
        ))}
      </View>

      {numOtras > 0 ? (
        <Boton
          etiqueta={textoOtrasNotas(numOtras)}
          tono="neutra"
          icono="nota"
          onPress={() => {
            setProblemas([]);
            setVerOtras(true);
          }}
          estilo={{ marginTop: espacio.sm }}
        />
      ) : null}
    </>,
    // Los errores de validar y de grabar, pegados a "Grabar" (como en la venta).
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
      {problemas.map((p) => (
        <Text key={p} style={estilos.error}>
          {p}
        </Text>
      ))}
      <Boton etiqueta="Grabar" icono="palomita" onPress={grabar} />
    </View>,
  );
}

/** Un renglon "etiqueta ... valor" de la nota al frente. */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const { estilos } = useTema();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm, marginTop: espacio.xs }}>
      <Text style={[estilos.textoSuave, { flexShrink: 1 }]}>{etiqueta}</Text>
      <Cifra valor={valor} />
    </View>
  );
}

/** Una nota de "Otras notas pendientes": folio, fecha, total, lo que debe y su condicion. */
function NotaElegible({
  nota,
  onPress,
  condicion = null,
}: {
  nota: NotaPendiente;
  onPress: () => void;
  /** "Debe liquidar" / "Debe abonar" de una nota asignada (`etiquetaCondicionPendiente`). */
  condicion?: string | null;
}) {
  const { estilos } = useTema();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Nota ${nota.folio}, debe ${pesos(nota.saldo_centavos)}`}
      onPress={onPress}
      style={({ pressed }) => [
        estilos.tarjeta,
        { gap: espacio.xs, borderWidth: grosor.fuerte, borderColor: colores.borde },
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.sm }}>
        <View style={{ flex: 1, gap: espacio.xs }}>
          <Text style={estilos.textoTarjeta}>
            Nota <Cifra valor={nota.folio} /> · {nota.fecha}
          </Text>
          <Text style={estilos.textoSuave}>
            Total <Cifra valor={pesos(nota.monto_total_centavos)} tono="suave" /> · debe{' '}
            <Cifra valor={pesos(nota.saldo_centavos)} tono="aviso" />
          </Text>
          {condicion ? <Pastilla texto={condicion} estado="pendiente" /> : null}
        </View>
        <Icono nombre="adelante" tamano={20} color={colores.tintaSuave} />
      </View>
    </Pressable>
  );
}

/** Una opcion corta en tira (Liquidar / Abonar, metodo de pago); la misma de la venta. */
function Chip({
  etiqueta,
  elegida,
  onPress,
  ancho = false,
}: {
  etiqueta: string;
  elegida: boolean;
  onPress: () => void;
  /** Reparte el ancho de la fila entre las opciones. */
  ancho?: boolean;
}) {
  const { dispositivo, t } = useTema();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: elegida }}
      accessibilityLabel={etiqueta}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: Math.min(dispositivo.tactil, 48),
          paddingHorizontal: espacio.md,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radio.chico,
          borderWidth: grosor.fuerte,
          borderColor: elegida ? colores.primario : colores.borde,
          backgroundColor: elegida ? colores.primarioTenue : colores.superficie,
        },
        ancho && { flex: 1 },
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
      ]}
    >
      <Text
        style={{
          fontFamily: fuente.cuerpoFuerte,
          fontSize: t(tipo.cuerpo),
          color: elegida ? colores.primario : colores.tinta,
        }}
      >
        {etiqueta}
      </Text>
    </Pressable>
  );
}
