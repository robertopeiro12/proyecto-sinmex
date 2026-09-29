import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  ErrorCobranza,
  ErrorFolio,
  leerAbonos,
  leerMontoCentavos,
  problemasDeCobro,
  type Cobranza,
  type MetodoPago,
  type NotaPendiente,
  type SyncEstado,
} from '@/datos';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra, pesos } from '@/ui/cifra';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Pastilla, Tarjeta, type Estado } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, grosor } from '@/ui/tokens';

/**
 * Los tres pasos del cobro (D16). Un cobro grabado no se edita en la tablet:
 * la revision es obligatoria y el folio se ensena en grande al final.
 */
type Paso = 'captura' | 'revision' | 'grabada';

const METODOS: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'cheque', etiqueta: 'Cheque' },
];

const NOMBRE_METODO: Record<MetodoPago, string> = {
  efectivo: 'efectivo',
  transferencia: 'transferencia',
  cheque: 'cheque',
};

/** Como se le dice al vendedor en que va cada cobro. */
const ETIQUETA_SYNC: Record<SyncEstado, string> = {
  pendiente: 'Por subir',
  enviando: 'Subiendo',
  sincronizado: 'Sincronizado',
  error: 'Con error',
};

const ESTADO_SYNC: Record<SyncEstado, Estado> = {
  pendiente: 'pendiente',
  enviando: 'pendiente',
  sincronizado: 'listo',
  error: 'error',
};

/** Centavos al texto del campo de monto, sin coma flotante ("150.50"). */
function textoMonto(centavos: number): string {
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

/**
 * Una nota pendiente que se puede elegir: folio, # de nota, fecha, total, saldo
 * y abonos previos ([[Cobranza-Abono]]: "mostrar fechas de abonos previos y
 * saldo pendiente").
 */
function NotaSeleccionable({
  nota,
  seleccionada,
  onPress,
}: {
  nota: NotaPendiente;
  seleccionada: boolean;
  onPress: () => void;
}) {
  const { estilos } = useTema();
  const abonos = leerAbonos(nota.abonos_json);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: seleccionada }}
      accessibilityLabel={`Nota ${nota.num_nota}, folio ${nota.folio}`}
      onPress={onPress}
      style={({ pressed }) => [
        estilos.tarjeta,
        {
          gap: espacio.xs,
          borderWidth: grosor.fuerte,
          borderColor: seleccionada ? colores.primario : colores.borde,
        },
        seleccionada && { backgroundColor: colores.primarioTenue },
        pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
      ]}
    >
      <Text style={estilos.textoTarjeta}>
        <Cifra valor={nota.folio} /> · nota <Cifra valor={nota.num_nota} /> · {nota.fecha}
      </Text>
      <Text style={estilos.textoSuave}>
        Total <Cifra valor={pesos(nota.monto_total_centavos)} tono="suave" /> · saldo{' '}
        <Cifra valor={pesos(nota.saldo_centavos)} tono="aviso" />
      </Text>
      {abonos.map((a, i) => (
        <Text key={`${a.fecha_pago}-${i}`} style={estilos.textoSuave}>
          Abono del {a.fecha_pago}: <Cifra valor={pesos(a.monto_centavos)} tono="suave" /> en{' '}
          {NOMBRE_METODO[a.metodo_pago] ?? a.metodo_pago}
        </Text>
      ))}
      {seleccionada ? <Text style={estilos.textoSuave}>Seleccionada</Text> : null}
    </Pressable>
  );
}

/**
 * Cobranza / abono de un cliente (T-20): elegir la nota, capturar el pago,
 * revisar el reparto y grabar con folio.
 *
 * El reparto (nota elegida → otras notas → saldo a favor) lo calcula el
 * repositorio con la misma funcion que el servidor; esta pantalla solo lo
 * muestra.
 */
export default function PantallaCobranza() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, vendedor, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();

  // El dia de trabajo del reloj de la tablet: el mismo con el que se emite el folio.
  const hoy = datos.deps.reloj.hoy();

  // `versionCatalogos` en las lecturas: grabar un cobro descuenta saldos y el
  // pull los reescribe; sin ella la pantalla no lo veria (defecto 2026-08-23).
  const cliente = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.obtenerCliente(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  const notas = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.notasPendientesDe(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  // "Cobros de hoy": se relee al volver a la pantalla y cuando el push cambia
  // su estado.
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  const cobrosDeHoy = useMemo(() => {
    void vueltas;
    void ultimaSincronizacion;
    void versionCatalogos;
    return datos.cobranzas.delDia(clienteId);
  }, [datos, clienteId, vueltas, ultimaSincronizacion, versionCatalogos]);

  const [paso, setPaso] = useState<Paso>('captura');
  const [notaId, setNotaId] = useState<string | null>(null);
  const [montoTexto, setMontoTexto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [fechaPago, setFechaPago] = useState(hoy);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [grabado, setGrabado] = useState<Cobranza | null>(null);
  const [grabando, setGrabando] = useState(false);

  const nota: NotaPendiente | null = notas.find((n) => n.id === notaId) ?? null;
  const montoCentavos = leerMontoCentavos(montoTexto);
  // `nota.id` siempre es `notaId` cuando `nota` no es null (viene de buscarlo por
  // ese id): pasar el primitivo y no el objeto deja que `useMemo` de abajo solo
  // dependa de un id, no de una referencia que cambia en cada render.
  const notaSeleccionadaId = nota?.id ?? null;

  // El reparto se deriva en vivo, no se congela en estado: si un pull cambia un
  // saldo mientras el vendedor esta en la revision, lo que ve tiene que seguir
  // siendo lo que `grabar()` va a escribir, no una foto de cuando entro.
  const reparto = useMemo(() => {
    void versionCatalogos;
    if (notaSeleccionadaId === null || montoCentavos === null) return null;
    return datos.cobranzas.previsualizar(clienteId, notaSeleccionadaId, montoCentavos);
  }, [datos, clienteId, notaSeleccionadaId, montoCentavos, versionCatalogos]);

  // Antes de este punto solo hay hooks: se llaman siempre, en el mismo orden.
  if (!cliente || !vendedor) {
    return (
      <Pantalla
        titulo="Cliente no encontrado"
        subtitulo="No está en el catálogo local de esta tablet."
      >
        <Text style={estilos.textoSuave}>
          Puede que lo hayan dado de alta después de tu última sincronización.
        </Text>
      </Pantalla>
    );
  }

  const vendedorId = vendedor.id;
  const nombreCliente = cliente.nombre;

  function elegirNota(id: string) {
    setNotaId(id);
    setProblemas([]);
  }

  function liquidar() {
    if (nota) setMontoTexto(textoMonto(nota.saldo_centavos));
  }

  function revisar() {
    const encontrados = problemasDeCobro({
      notaFecha: nota?.fecha ?? null,
      montoCentavos,
      metodoPago: metodo,
      fechaPago,
      hoy,
    });
    setProblemas(encontrados);
    if (encontrados.length > 0 || nota === null || montoCentavos === null) return;
    setPaso('revision');
  }

  function corregir() {
    setProblemas([]);
    setPaso('captura');
  }

  function grabar() {
    // `revisar` no deja llegar aqui sin nota ni monto; la comprobacion es para el tipo.
    if (nota === null || montoCentavos === null) return;
    // Guardia contra doble toque: `registrar()` emite folio, y un segundo toque
    // mientras el primero corre no debe emitir un segundo.
    if (grabando) return;
    setGrabando(true);
    try {
      const cobro = datos.cobranzas.registrar({
        vendedorId,
        clienteId,
        ventaNotaId: nota.id,
        montoCentavos,
        metodoPago: metodo,
        fechaPago,
      });
      setProblemas([]);
      setGrabado(cobro);
      setPaso('grabada');
    } catch (e) {
      setProblemas([
        e instanceof ErrorCobranza || e instanceof ErrorFolio
          ? e.message
          : 'No se pudo grabar el cobro. No se consumió ningún folio; intenta de nuevo.',
      ]);
    } finally {
      setGrabando(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 3. Grabada: el folio en grande                                    */
  /* ---------------------------------------------------------------- */

  if (paso === 'grabada' && grabado) {
    return (
      <Pantalla
        titulo="Cobro grabado"
        subtitulo={`${nombreCliente} · anota este folio en el recibo del cliente.`}
      >
        <Tarjeta estado="listo" etiqueta="Folio">
          <Cifra valor={grabado.folio} tamano="grande" />
          <Text style={estilos.textoSuave}>
            <Cifra valor={pesos(grabado.monto_centavos)} tono="suave" /> en{' '}
            {NOMBRE_METODO[grabado.metodo_pago]} · pagado el {grabado.fecha_pago}
          </Text>
          <Text style={estilos.textoSuave}>
            Quedó guardado en la tablet y sube solo al sincronizar. Si otra tablet o la oficina ya
            cobró esa nota, el servidor pasa el dinero a las otras notas o al saldo a favor.
          </Text>
        </Tarjeta>

        {/* Unica accion de este paso. */}
        <Boton
          etiqueta="Volver al cliente"
          glifo="←"
          onPress={() => router.back()}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      </Pantalla>
    );
  }

  /* ---------------------------------------------------------------- */
  /* 2. Revision: el reparto previsto                                  */
  /* ---------------------------------------------------------------- */

  if (paso === 'revision' && reparto && nota && montoCentavos !== null) {
    const folioDe = (id: string) => notas.find((n) => n.id === id)?.folio ?? id;
    return (
      <Pantalla
        titulo="Revisa el cobro"
        subtitulo={`${nombreCliente} · un cobro grabado no se puede editar.`}
      >
        <Tarjeta estado="accion" etiqueta="Cobro">
          <Cifra valor={pesos(montoCentavos)} tamano="grande" />
          <Text style={estilos.textoSuave}>
            En {NOMBRE_METODO[metodo]} · pagado el {fechaPago.trim()} · nota{' '}
            <Cifra valor={nota.num_nota} tono="suave" />
          </Text>
        </Tarjeta>

        <Tarjeta etiqueta="Cómo se reparte">
          {reparto.aplicaciones.map((a) => (
            <Text key={a.notaId} style={estilos.textoTarjeta}>
              <Cifra valor={folioDe(a.notaId)} /> · <Cifra valor={pesos(a.montoCentavos)} /> ·{' '}
              {a.saldoDespuesCentavos === 0 ? (
                'queda pagada'
              ) : (
                <>
                  queda debiendo <Cifra valor={pesos(a.saldoDespuesCentavos)} tono="aviso" />
                </>
              )}
            </Text>
          ))}
          {reparto.saldoFavorCentavos > 0 ? (
            <Text style={estilos.textoTarjeta}>
              Saldo a favor del cliente:{' '}
              <Cifra valor={pesos(reparto.saldoFavorCentavos)} tono="exito" />
            </Text>
          ) : null}
        </Tarjeta>

        {problemas.map((p) => (
          <Text key={p} style={estilos.error}>
            {p}
          </Text>
        ))}

        {/*
          Opuestas en tres ejes (sistema de diseno): Grabar es relleno naranja con
          ✓; Corregir es contorno neutro con ←. Grabar es la unica primaria.
        */}
        <View style={estilos.filaAcciones}>
          <Boton etiqueta="Corregir" tono="neutra" glifo="←" onPress={corregir} />
          <Boton etiqueta="Grabar cobro" glifo="✓" onPress={grabar} ocupado={grabando} />
        </View>
      </Pantalla>
    );
  }

  /* ---------------------------------------------------------------- */
  /* 1. Captura                                                        */
  /* ---------------------------------------------------------------- */

  // Lo mas grave manda: un error sobre "falta subir", y "falta subir" sobre "todo subido".
  const estadoCobros: Estado = cobrosDeHoy.some((c) => c.sync_estado === 'error')
    ? 'error'
    : cobrosDeHoy.some((c) => c.sync_estado !== 'sincronizado')
      ? 'pendiente'
      : cobrosDeHoy.length > 0
        ? 'listo'
        : 'neutro';

  return (
    <Pantalla
      formulario
      titulo={`Cobranza · ${nombreCliente}`}
      subtitulo="Elige la nota que paga. Si paga de más, el resto va a sus otras notas y después a saldo a favor."
    >
      {cliente.saldo_favor_centavos > 0 ? (
        <Tarjeta estado="listo" etiqueta="Saldo a favor">
          <Cifra valor={pesos(cliente.saldo_favor_centavos)} tamano="destacado" tono="exito" />
          <Text style={estilos.textoSuave}>Lo aplica la oficina desde el portal.</Text>
        </Tarjeta>
      ) : null}

      <Text style={estilos.seccion}>Notas pendientes</Text>
      {notas.length === 0 ? (
        <Tarjeta etiqueta="Sin notas">
          <Text style={estilos.textoTarjeta}>Este cliente no tiene notas pendientes en la tablet.</Text>
          <Text style={estilos.textoSuave}>Las notas bajan del portal al sincronizar.</Text>
        </Tarjeta>
      ) : (
        notas.map((n) => (
          <NotaSeleccionable
            key={n.id}
            nota={n}
            seleccionada={n.id === notaId}
            onPress={() => elegirNota(n.id)}
          />
        ))
      )}

      {nota ? (
        <>
          <Text style={estilos.seccion}>Pago</Text>
          <View style={estilos.filaAcciones}>
            <View style={{ flex: 1 }}>
              <Campo
                etiqueta="Monto cobrado"
                cifra
                value={montoTexto}
                onChangeText={setMontoTexto}
                invalido={montoTexto.trim() !== '' && montoCentavos === null}
                placeholder="0.00"
                // `cifra` pone `number-pad`, que en Android no tiene punto: el
                // monto lleva centavos. `Campo` aplica las props despues.
                keyboardType="decimal-pad"
              />
            </View>
            <Boton
              etiqueta="Liquidar"
              tono="neutra"
              glifo="="
              ancho="ajustado"
              onPress={liquidar}
            />
          </View>

          <Text style={estilos.seccion}>Método de pago</Text>
          <View style={estilos.rejilla}>
            {METODOS.map((m) => (
              <Opcion
                key={m.valor}
                etiqueta={m.etiqueta}
                seleccionada={metodo === m.valor}
                onPress={() => setMetodo(m.valor)}
              />
            ))}
          </View>

          <View style={{ marginTop: espacio.lg }}>
            <Campo
              etiqueta="Fecha de pago"
              value={fechaPago}
              onChangeText={setFechaPago}
              maxLength={10}
              placeholder="AAAA-MM-DD"
              ayuda={`Entre ${nota.fecha} y ${hoy}.`}
            />
          </View>
        </>
      ) : null}

      {problemas.map((p) => (
        <Text key={p} style={estilos.error}>
          {p}
        </Text>
      ))}

      {/* Unica accion primaria de la captura. */}
      <Boton
        etiqueta="Revisar"
        glifo="→"
        onPress={revisar}
        deshabilitado={notas.length === 0}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.lg }}
      />

      <Tarjeta estado={estadoCobros} etiqueta="Cobros de hoy">
        {cobrosDeHoy.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no le has cobrado hoy.</Text>
        ) : (
          cobrosDeHoy.map((c) => (
            <View key={c.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
              <Text style={estilos.textoTarjeta}>
                <Cifra valor={c.folio} /> · <Cifra valor={pesos(c.monto_centavos)} /> ·{' '}
                {NOMBRE_METODO[c.metodo_pago]}
              </Text>
              <Pastilla texto={ETIQUETA_SYNC[c.sync_estado]} estado={ESTADO_SYNC[c.sync_estado]} />
              {c.sync_estado === 'error' && c.sync_error ? (
                <Text style={estilos.error}>{c.sync_error}</Text>
              ) : null}
            </View>
          ))
        )}
      </Tarjeta>
    </Pantalla>
  );
}
