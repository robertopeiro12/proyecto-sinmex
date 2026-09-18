import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import {
  ErrorFolio,
  ErrorVenta,
  LARGO_MAX_COMENTARIOS,
  LARGO_MAX_NUM_NOTA,
  leerCantidad,
  problemasDeCaptura,
  resumirCaptura,
  type ContadoCredito,
  type FacturaVenta,
  type LineaCaptura,
  type Venta,
} from '@/datos';
import { useJawa } from '@/estado/proveedor-jawa';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra, pesos } from '@/ui/cifra';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Los tres pasos de la venta (D17).
 *
 * Una venta grabada **no se edita ni se anula** en la tablet (D3), asi que la
 * revision es obligatoria antes de grabar, y el folio se ensena en grande al
 * final para escribirlo en la nota fisica.
 */
type Paso = 'captura' | 'revision' | 'grabada';

/** Lo que el vendedor teclea en una fila, tal cual (texto). */
interface CapturaTexto {
  cantidad: string;
  promocion: string;
}

/**
 * Venta a un cliente (T-16): captura, revision y folio.
 *
 * El vendedor solo captura cantidades y piezas de promocion. Los precios se
 * **muestran** pero no se envian: `datos.ventas.registrar()` los pone desde el
 * catalogo local (D15), asi que un error de esta pantalla no puede grabar un
 * precio distinto al del catalogo.
 */
export default function PantallaVenta() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, vendedor, versionCatalogos } = useJawa();
  const { estilos } = useTema();

  // El dia de trabajo del reloj de la tablet: el mismo con el que se emite el folio.
  const hoy = datos.deps.reloj.hoy();

  // `versionCatalogos` en las tres lecturas: sin ella, la pantalla no ve lo que
  // escribe el pull (defecto del primer arranque, 2026-08-23). Se lee con
  // `void` para que `exhaustive-deps` no la marque como sobrante.
  const cliente = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.obtenerCliente(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  const presentaciones = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.presentacionesParaVenta(clienteId, hoy);
  }, [datos, clienteId, hoy, versionCatalogos]);

  const notas = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.notasPendientesDe(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  const [paso, setPaso] = useState<Paso>('captura');
  const [capturas, setCapturas] = useState<Record<string, CapturaTexto>>({});
  const [contadoCredito, setContadoCredito] = useState<ContadoCredito | null>(null);
  const [factura, setFactura] = useState<FacturaVenta>('N/A');
  const [numNota, setNumNota] = useState('');
  const [comentarios, setComentarios] = useState('');
  const [problemas, setProblemas] = useState<string[]>([]);
  const [grabada, setGrabada] = useState<Venta | null>(null);
  const [grabando, setGrabando] = useState(false);

  const lineas = useMemo<LineaCaptura[]>(
    () =>
      presentaciones.map((p) => {
        const captura = capturas[p.presentacion_id];
        return {
          presentacionId: p.presentacion_id,
          etiqueta: `${p.producto_nombre} ${p.volumen}`,
          // Una cantidad ilegible viaja como NaN para que `problemasDeCaptura`
          // la senale en su fila, en vez de volverse 0 en silencio.
          cantidad: leerCantidad(captura?.cantidad ?? '') ?? Number.NaN,
          cantidadPromocion: leerCantidad(captura?.promocion ?? '') ?? Number.NaN,
          precioCentavos: p.precio_centavos,
        };
      }),
    [presentaciones, capturas],
  );

  const resumen = useMemo(() => resumirCaptura(lineas), [lineas]);

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

  function capturar(presentacionId: string, campo: keyof CapturaTexto, valor: string) {
    setCapturas((previas) => {
      const actual = previas[presentacionId] ?? { cantidad: '', promocion: '' };
      return { ...previas, [presentacionId]: { ...actual, [campo]: valor } };
    });
  }

  function revisar() {
    const encontrados = problemasDeCaptura({ numNota, contadoCredito, comentarios, lineas });
    setProblemas(encontrados);
    if (encontrados.length === 0) setPaso('revision');
  }

  function grabar() {
    // `revisar` no deja llegar aqui sin elegir; la comprobacion es para el tipo.
    if (contadoCredito === null) return;
    // Guardia contra doble toque: `registrar()` emite folio, y un segundo toque
    // mientras el primero corre no debe emitir un segundo.
    if (grabando) return;
    setGrabando(true);
    try {
      const venta = datos.ventas.registrar({
        vendedorId,
        clienteId,
        numNota,
        contadoCredito,
        factura,
        comentarios: comentarios.trim() === '' ? null : comentarios,
        // Sin precios: los pone el repositorio (D15).
        lineas: resumen.lineas.map((l) => ({
          presentacionId: l.presentacionId,
          cantidad: l.cantidad,
          cantidadPromocion: l.cantidadPromocion,
        })),
      });
      setProblemas([]);
      setGrabada(venta);
      setPaso('grabada');
    } catch (e) {
      setProblemas([
        e instanceof ErrorVenta || e instanceof ErrorFolio
          ? e.message
          : 'No se pudo grabar la venta. No se consumió ningún folio; intenta de nuevo.',
      ]);
    } finally {
      setGrabando(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 3. Grabada: el folio en grande                                    */
  /* ---------------------------------------------------------------- */

  if (paso === 'grabada' && grabada) {
    return (
      <Pantalla
        titulo="Venta grabada"
        subtitulo={`${nombreCliente} · escribe este folio en la nota física.`}
      >
        <Tarjeta estado="listo" etiqueta="Folio">
          <Cifra valor={grabada.folio} tamano="grande" />
          <Text style={estilos.textoSuave}>
            Total <Cifra valor={pesos(grabada.monto_total_centavos)} tono="suave" /> · nota{' '}
            <Cifra valor={grabada.num_nota} tono="suave" /> ·{' '}
            {grabada.contado_credito === 'contado' ? 'de contado' : 'a crédito'}
          </Text>
          <Text style={estilos.textoSuave}>
            Quedó guardada en la tablet y sube sola al sincronizar. Una venta grabada no se edita:
            si hay un error, se corrige desde el portal.
          </Text>
        </Tarjeta>

        {/*
          D6 (T-20): consignacion. Si el cliente tiene notas pendientes, se
          ofrece cobrarlas en un paso aparte. Es neutra (contorno, $) para que
          la primaria siga siendo volver (relleno, ←). `replace` y no `push`:
          al terminar el cobro, "Volver al cliente" regresa a la ficha y no a
          esta venta ya grabada.
        */}
        {notas.length > 0 ? (
          <View style={[estilos.filaAcciones, { marginTop: espacio.lg, marginBottom: espacio.xl }]}>
            <Boton
              etiqueta={`Cobrar notas pendientes (${notas.length})`}
              tono="neutra"
              glifo="$"
              onPress={() =>
                router.replace({
                  pathname: '/(jornada)/operacion/[clienteId]/cobranza',
                  params: { clienteId },
                })
              }
            />
            <Boton etiqueta="Volver al cliente" glifo="←" onPress={() => router.back()} />
          </View>
        ) : (
          <Boton
            etiqueta="Volver al cliente"
            glifo="←"
            onPress={() => router.back()}
            estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
          />
        )}
      </Pantalla>
    );
  }

  /* ---------------------------------------------------------------- */
  /* 2. Revision: lo ultimo que se ve antes de grabar                  */
  /* ---------------------------------------------------------------- */

  if (paso === 'revision') {
    return (
      <Pantalla
        titulo="Revisa la venta"
        subtitulo={`${nombreCliente} · una vez grabada no se puede editar.`}
      >
        <Tarjeta etiqueta="Productos">
          {resumen.lineas.map((l) => (
            <View
              key={l.presentacionId}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: espacio.sm,
                marginBottom: espacio.xs,
              }}
            >
              <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{l.etiqueta}</Text>
              <Text style={estilos.textoSuave}>
                <Cifra valor={l.cantidad} /> × <Cifra valor={pesos(l.precioCentavos ?? 0)} tono="suave" />
                {l.cantidadPromocion > 0 ? (
                  <>
                    {' + '}
                    <Cifra valor={l.cantidadPromocion} tono="suave" /> de promoción
                  </>
                ) : null}
                {' = '}
                <Cifra valor={pesos(l.importeCentavos)} />
              </Text>
            </View>
          ))}
        </Tarjeta>

        <Tarjeta estado="accion" etiqueta="Total">
          <Cifra valor={pesos(resumen.totalCentavos)} tamano="grande" />
          <Text style={estilos.textoSuave}>
            {contadoCredito === 'contado' ? 'De contado' : 'A crédito'} · nota{' '}
            <Cifra valor={numNota.trim()} tono="suave" /> · factura {factura}
          </Text>
          {comentarios.trim() !== '' ? (
            <Text style={estilos.textoSuave}>{comentarios.trim()}</Text>
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
          <Boton etiqueta="Corregir" tono="neutra" glifo="←" onPress={() => setPaso('captura')} />
          <Boton etiqueta="Grabar venta" glifo="✓" onPress={grabar} ocupado={grabando} />
        </View>
      </Pantalla>
    );
  }

  /* ---------------------------------------------------------------- */
  /* 1. Captura                                                        */
  /* ---------------------------------------------------------------- */

  return (
    <Pantalla
      formulario
      titulo={`Venta · ${nombreCliente}`}
      subtitulo="Captura solo cantidades: el precio sale del catálogo del cliente."
    >
      {notas.length > 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Notas pendientes (solo lectura)">
          {notas.map((n) => (
            <Text key={n.id} style={estilos.textoSuave}>
              <Cifra valor={n.folio} tono="suave" /> · nota <Cifra valor={n.num_nota} tono="suave" /> ·{' '}
              {n.fecha} · saldo <Cifra valor={pesos(n.saldo_centavos)} tono="aviso" />
            </Text>
          ))}
          <Text style={estilos.textoSuave}>
            Se cobran desde «Cobranza / abono», también al terminar esta venta.
          </Text>
        </Tarjeta>
      ) : null}

      <Text style={estilos.seccion}>Productos</Text>
      {presentaciones.length === 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Catálogo vacío">
          <Text style={estilos.textoTarjeta}>Sin productos en el catálogo local</Text>
          <Text style={estilos.textoSuave}>
            Los productos bajan del portal con la sincronización.
          </Text>
        </Tarjeta>
      ) : (
        presentaciones.map((p) => {
          const captura = capturas[p.presentacion_id];
          const cantidad = leerCantidad(captura?.cantidad ?? '');
          const promocion = leerCantidad(captura?.promocion ?? '');
          const sinPrecio = p.precio_centavos === null || p.precio_centavos === 0;
          return (
            <Tarjeta key={p.presentacion_id} etiqueta={`${p.producto_nombre} · ${p.volumen}`}>
              <Text style={estilos.textoSuave}>
                {sinPrecio ? (
                  'Sin precio para este cliente: solo promoción.'
                ) : (
                  <>
                    Precio <Cifra valor={pesos(p.precio_centavos ?? 0)} tono="suave" />
                  </>
                )}
              </Text>
              <View style={estilos.filaAcciones}>
                <View style={{ flex: 1 }}>
                  <Campo
                    etiqueta="Cantidad"
                    cifra
                    value={captura?.cantidad ?? ''}
                    onChangeText={(v) => capturar(p.presentacion_id, 'cantidad', v)}
                    invalido={cantidad === null || (sinPrecio && (cantidad ?? 0) > 0)}
                    placeholder="0"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Campo
                    etiqueta="Promoción"
                    cifra
                    value={captura?.promocion ?? ''}
                    onChangeText={(v) => capturar(p.presentacion_id, 'promocion', v)}
                    invalido={promocion === null}
                    placeholder="0"
                  />
                </View>
              </View>
            </Tarjeta>
          );
        })
      )}

      <Text style={estilos.seccion}>Pago</Text>
      <View style={estilos.rejilla}>
        <Opcion
          etiqueta="Contado"
          seleccionada={contadoCredito === 'contado'}
          onPress={() => setContadoCredito('contado')}
        />
        <Opcion
          etiqueta="Crédito"
          seleccionada={contadoCredito === 'credito'}
          onPress={() => setContadoCredito('credito')}
        />
      </View>

      <Text style={estilos.seccion}>Factura</Text>
      <View style={estilos.rejilla}>
        <Opcion etiqueta="N/A" seleccionada={factura === 'N/A'} onPress={() => setFactura('N/A')} />
        <Opcion
          etiqueta="Pendiente"
          seleccionada={factura === 'pendiente'}
          onPress={() => setFactura('pendiente')}
        />
      </View>

      <View style={{ marginTop: espacio.lg }}>
        <Campo
          etiqueta="Número de nota"
          value={numNota}
          onChangeText={setNumNota}
          maxLength={LARGO_MAX_NUM_NOTA}
          placeholder="El de la nota física"
        />
        <Campo
          etiqueta="Comentarios (opcional)"
          value={comentarios}
          onChangeText={setComentarios}
          maxLength={LARGO_MAX_COMENTARIOS}
          multiline
        />
      </View>

      <Tarjeta estado="accion" etiqueta="Total">
        <Cifra valor={pesos(resumen.totalCentavos)} tamano="grande" />
        <Text style={estilos.textoSuave}>
          <Cifra valor={resumen.piezas} tono="suave" /> pieza(s) ·{' '}
          <Cifra valor={resumen.piezasPromocion} tono="suave" /> de promoción
        </Text>
      </Tarjeta>

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
        deshabilitado={presentaciones.length === 0}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
