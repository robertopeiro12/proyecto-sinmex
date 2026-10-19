import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import {
  aplicarRegalos,
  calcularRegalos,
  ErrorFolio,
  ErrorJornada,
  ErrorVenta,
  LARGO_MAX_COMENTARIOS,
  LARGO_MAX_NUM_NOTA,
  leerCantidad,
  problemasDeCaptura,
  problemasDeRegalos,
  resumirCaptura,
  type ContadoCredito,
  type FacturaVenta,
  type LineaCaptura,
  type Venta,
} from '@/datos';
import {
  crearGrabadorVenta,
  ErrorFirma,
  FIRMA_VACIA,
  hayFirma,
  LARGO_MAX_NOMBRE_FIRMA,
  MENSAJE_FALLO_FIRMA,
  normalizarNombreFirma,
  puedeGrabarVenta,
  textoFirmada,
  type EstadoFirma,
} from '@/estado/firma';
import { useJawa } from '@/estado/proveedor-jawa';
import { guardarFirmaJpg } from '@/fotos/firma-expo';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra, pesos } from '@/ui/cifra';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { RecuadroFirma, type ControlFirma } from '@/ui/recuadro-firma';
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
}

/**
 * Venta a un cliente (T-16): captura, revision y folio.
 *
 * El vendedor solo captura cantidades; las piezas de promocion las calcula la
 * app con las promociones del cliente (T-74, D6). Los precios se
 * **muestran** pero no se envian: `datos.ventas.registrar()` los pone desde el
 * catalogo local (D15), asi que un error de esta pantalla no puede grabar un
 * precio distinto al del catalogo.
 * T-73: la revision pide la firma del cliente (obligatoria) y "Corregir" la borra (D4).
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

  const catalogoPromos = useMemo(() => {
    void versionCatalogos;
    return datos.promociones.catalogo();
  }, [datos, versionCatalogos]);

  const promociones = useMemo(() => {
    void versionCatalogos;
    return datos.promociones.aplicablesPara(clienteId);
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
  /** Promociones cuyo regalo el cliente no quiso (D6). */
  const [descartados, setDescartados] = useState<Set<string>>(new Set());
  /** promocion_id -> presentacion elegida para un regalo de producto completo (D16). */
  const [elecciones, setElecciones] = useState<Map<string, string>>(new Map());
  /** T-73: la firma del cliente (trazos y nombre), capturada en la revision (D3). */
  const [firma, setFirma] = useState<EstadoFirma>(FIRMA_VACIA);
  /** Mientras el dedo esta en el recuadro, la pantalla no se desplaza. */
  const [dibujando, setDibujando] = useState(false);
  const recuadro = useRef<ControlFirma>(null);
  /**
   * T-73: el id de la venta se genera ANTES de grabar, porque nombra el archivo
   * de la firma. Se conserva mientras la pantalla siga abierta: un reintento
   * sobrescribe el mismo `firma-<id>.jpg` en vez de dejar huerfanos.
   */
  const [ventaId] = useState(() => datos.deps.generarId());
  /** Guardia de doble toque: exportar, convertir y grabar es asincrono (Review Focus 3). */
  const [grabador] = useState(() => crearGrabadorVenta<Venta>());

  // Todas las presentaciones van como base, aunque no se compren: un regalo a
  // una presentacion que el vendedor no capturo necesita su linea.
  const lineasBase = useMemo<LineaCaptura[]>(
    () =>
      presentaciones.map((p) => {
        const captura = capturas[p.presentacion_id];
        return {
          presentacionId: p.presentacion_id,
          etiqueta: `${p.producto_nombre} ${p.volumen}`,
          // Una cantidad ilegible viaja como NaN para que `problemasDeCaptura`
          // la senale en su fila, en vez de volverse 0 en silencio.
          cantidad: leerCantidad(captura?.cantidad ?? '') ?? Number.NaN,
          cantidadPromocion: 0,
          precioCentavos: p.precio_centavos,
        };
      }),
    [presentaciones, capturas],
  );

  // D6: los regalos los calcula la app sobre lo capturado; el vendedor solo
  // puede quitarlos (`descartados`) o elegir presentacion (`elecciones`, D16).
  const regalosPosibles = useMemo(
    () => calcularRegalos(lineasBase, promociones, catalogoPromos, elecciones),
    [lineasBase, promociones, catalogoPromos, elecciones],
  );
  const { lineas, regalos } = useMemo(
    () => aplicarRegalos(lineasBase, regalosPosibles, descartados),
    [lineasBase, regalosPosibles, descartados],
  );
  const resumen = useMemo(() => resumirCaptura(lineas), [lineas]);
  /** Piezas gratis por presentacion, para el texto bajo cada fila. */
  const gratisPor = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of regalos) {
      if (r.presentacionId) m.set(r.presentacionId, (m.get(r.presentacionId) ?? 0) + r.cantidad);
    }
    return m;
  }, [regalos]);

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

  function capturar(presentacionId: string, valor: string) {
    setCapturas((previas) => ({ ...previas, [presentacionId]: { cantidad: valor } }));
  }

  function alternarDescarte(promocionId: string) {
    setDescartados((previos) => {
      const s = new Set(previos);
      if (s.has(promocionId)) s.delete(promocionId);
      else s.add(promocionId);
      return s;
    });
  }

  function revisar() {
    const encontrados = [
      ...problemasDeCaptura({ numNota, contadoCredito, comentarios, lineas }),
      ...problemasDeRegalos(regalos),
    ];
    setProblemas(encontrados);
    if (encontrados.length === 0) setPaso('revision');
  }

  function volverACaptura() {
    // D4: el cliente firmo un total; si cambian las cantidades, firma otra vez.
    // Los trazos los vacia el propio recuadro con su `borrar` (la misma funcion
    // que "Borrar firma", ruling F7); si no estuviera montado, FIRMA_VACIA basta:
    // al volver a la revision se monta de nuevo con esos trazos vacios.
    recuadro.current?.borrar();
    setFirma(FIRMA_VACIA);
    setProblemas([]);
    setPaso('captura');
  }

  async function grabar() {
    // `revisar` no deja llegar aqui sin elegir; la comprobacion es para el tipo.
    if (contadoCredito === null) return;
    const pago = contadoCredito;
    let nombre: string | null = null;
    try {
      nombre = normalizarNombreFirma(firma.nombre);
    } catch (e) {
      setProblemas([e instanceof ErrorFirma ? e.message : MENSAJE_FALLO_FIRMA]);
      return;
    }
    setGrabando(true);
    const resultado = await grabador.grabar({
      exportarPng: () => {
        const control = recuadro.current;
        return control
          ? control.exportarPng()
          : Promise.reject(new ErrorFirma('El recuadro de firma no está en pantalla.'));
      },
      guardarJpg: (png) => guardarFirmaJpg(ventaId, png),
      registrar: (firmaUri) =>
        datos.ventas.registrar({
          id: ventaId,
          vendedorId,
          clienteId,
          numNota,
          contadoCredito: pago,
          factura,
          comentarios: comentarios.trim() === '' ? null : comentarios,
          // Sin precios: los pone el repositorio (D15).
          lineas: resumen.lineas.map((l) => ({
            presentacionId: l.presentacionId,
            cantidad: l.cantidad,
            cantidadPromocion: l.cantidadPromocion,
          })),
          // Solo los regalos con presentacion: `revisar` ya exigio elegirla, y el
          // repositorio vuelve a comprobar que cuadran con `cantidadPromocion`.
          regalos: regalos
            .filter((r) => r.presentacionId !== null)
            .map((r) => ({
              promocionId: r.promocionId,
              presentacionId: r.presentacionId as string,
              cantidad: r.cantidad,
              texto: r.texto,
            })),
          // T-73: misma transaccion que la venta, sus lineas y su folio.
          firma: { uri: firmaUri, nombre },
        }),
    });
    // Segundo toque mientras el primero corre: el primero se encarga de todo.
    if (resultado === null) return;
    setGrabando(false);
    if (resultado.estado === 'grabada') {
      setProblemas([]);
      setGrabada(resultado.venta);
      setPaso('grabada');
      return;
    }
    if (resultado.estado === 'sin-firma') {
      // No se llamo a `registrar`: ni venta ni folio. La firma sigue en el recuadro.
      setProblemas([resultado.mensaje]);
      return;
    }
    const e = resultado.error;
    setProblemas([
      e instanceof ErrorVenta || e instanceof ErrorFolio || e instanceof ErrorJornada
        ? e.message
        : 'No se pudo grabar la venta. No se consumió ningún folio; intenta de nuevo.',
    ]);
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
            Total <Cifra valor={pesos(grabada.monto_total_centavos)} tono="suave" /> ·{' '}
            {grabada.num_nota ? (
              <>
                nota <Cifra valor={grabada.num_nota} tono="suave" /> ·{' '}
              </>
            ) : null}
            {grabada.contado_credito === 'contado' ? 'de contado' : 'a crédito'}
          </Text>
          <Text style={estilos.textoTarjeta}>{textoFirmada(grabada.firma_nombre)}</Text>
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
        desplazable={!dibujando}
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

        {regalos.length > 0 ? (
          <Tarjeta estado="listo" etiqueta="Regalos">
            {regalos.map((r) => (
              <Text key={r.promocionId} style={estilos.textoTarjeta}>
                <Cifra valor={r.cantidad} /> ×{' '}
                {r.presentacionId ? catalogoPromos.presentaciones.get(r.presentacionId)?.etiqueta : ''} ·{' '}
                {r.texto}
              </Text>
            ))}
          </Tarjeta>
        ) : null}

        <Tarjeta estado="accion" etiqueta="Total">
          <Cifra valor={pesos(resumen.totalCentavos)} tamano="grande" />
          <Text style={estilos.textoSuave}>
            {contadoCredito === 'contado' ? 'De contado' : 'A crédito'} ·{' '}
            {numNota.trim() !== '' ? (
              <>
                nota <Cifra valor={numNota.trim()} tono="suave" /> ·{' '}
              </>
            ) : null}
            factura {factura}
          </Text>
          {comentarios.trim() !== '' ? (
            <Text style={estilos.textoSuave}>{comentarios.trim()}</Text>
          ) : null}
        </Tarjeta>

        {/*
          T-73 (D1, D3): la firma se captura aqui, antes de grabar, y se guarda en
          la misma transaccion. Sin firma, "Grabar venta" no se habilita.
        */}
        <Tarjeta estado={hayFirma(firma.trazos) ? 'listo' : 'pendiente'} etiqueta="Firma del cliente">
          <Text style={estilos.textoSuave}>Pide al cliente que firme con el dedo.</Text>
          <RecuadroFirma
            ref={recuadro}
            trazos={firma.trazos}
            alCambiar={(trazos) => setFirma((previa) => ({ ...previa, trazos }))}
            alDibujar={setDibujando}
            deshabilitado={grabando}
          />
          <Campo
            etiqueta="Nombre de quien firma (opcional)"
            value={firma.nombre}
            onChangeText={(nombre) => setFirma((previa) => ({ ...previa, nombre }))}
            maxLength={LARGO_MAX_NOMBRE_FIRMA}
            editable={!grabando}
          />
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
          <Boton
            etiqueta="Corregir"
            tono="neutra"
            glifo="←"
            onPress={volverACaptura}
            deshabilitado={grabando}
          />
          <Boton
            etiqueta="Grabar venta"
            glifo="✓"
            onPress={() => void grabar()}
            ocupado={grabando}
            deshabilitado={!puedeGrabarVenta({ contadoCredito, trazos: firma.trazos, grabando })}
          />
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
      {/* T-74 (D11): la misma tarjeta de la ficha, para saber que esperar al capturar. */}
      {promociones.length > 0 ? (
        <Tarjeta estado="listo" etiqueta="Promociones">
          {promociones.map((p) => (
            <Text key={p.id} style={estilos.textoTarjeta}>
              {p.texto}
              {p.audiencia === 'prospecto' ? ' (primera venta)' : ''}
            </Text>
          ))}
        </Tarjeta>
      ) : null}

      {notas.length > 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Notas pendientes (solo lectura)">
          {notas.map((n) => (
            <Text key={n.id} style={estilos.textoSuave}>
              <Cifra valor={n.folio} tono="suave" /> ·{' '}
              {n.num_nota ? (
                <>
                  nota <Cifra valor={n.num_nota} tono="suave" /> ·{' '}
                </>
              ) : null}
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
          const sinPrecio = p.precio_centavos === null || p.precio_centavos === 0;
          return (
            <Tarjeta key={p.presentacion_id} etiqueta={`${p.producto_nombre} · ${p.volumen}`}>
              <Text style={estilos.textoSuave}>
                {sinPrecio ? (
                  'Sin precio para este cliente: solo puede ir como regalo.'
                ) : (
                  <>
                    Precio <Cifra valor={pesos(p.precio_centavos ?? 0)} tono="suave" />
                  </>
                )}
              </Text>
              {gratisPor.has(p.presentacion_id) ? (
                <Text style={estilos.textoTarjeta}>
                  +<Cifra valor={gratisPor.get(p.presentacion_id) ?? 0} /> gratis por promoción
                </Text>
              ) : null}
              {/* Sin precio no se vende (el servidor rechaza piezas a $0): el campo
                  queda bloqueado y la fila solo recibe regalos. */}
              <Campo
                etiqueta="Cantidad"
                cifra
                value={captura?.cantidad ?? ''}
                onChangeText={(v) => capturar(p.presentacion_id, v)}
                editable={!sinPrecio}
                invalido={cantidad === null || (sinPrecio && (cantidad ?? 0) > 0)}
                placeholder="0"
              />
            </Tarjeta>
          );
        })
      )}

      {regalosPosibles.length > 0 ? (
        <Tarjeta estado="listo" etiqueta="Regalos por promoción">
          {regalosPosibles.map((r) => {
            const descartado = descartados.has(r.promocionId);
            const opciones = [...catalogoPromos.presentaciones].filter(
              ([, pres]) => pres.productoId === r.productoId,
            );
            // D16: solo el regalo de producto completo con varias presentaciones se
            // elige; la lista se queda visible para corregir un toque equivocado.
            const elegible =
              promociones.find((p) => p.id === r.promocionId)?.regalo_tipo === 'producto' &&
              opciones.length > 1;
            return (
              <View key={r.promocionId} style={{ marginBottom: espacio.sm, gap: espacio.xs }}>
                <Text
                  style={[estilos.textoTarjeta, descartado && { textDecorationLine: 'line-through' }]}
                >
                  <Cifra valor={r.cantidad} /> gratis · {r.texto}
                </Text>
                {!descartado && elegible ? (
                  <View style={estilos.rejilla}>
                    {opciones.map(([id, pres]) => (
                      <Opcion
                        key={id}
                        etiqueta={pres.etiqueta}
                        seleccionada={id === r.presentacionId}
                        onPress={() => setElecciones((previas) => new Map(previas).set(r.promocionId, id))}
                      />
                    ))}
                  </View>
                ) : null}
                {!descartado && !elegible && r.presentacionId !== null ? (
                  <Text style={estilos.textoSuave}>
                    {catalogoPromos.presentaciones.get(r.presentacionId)?.etiqueta}
                  </Text>
                ) : null}
                <Boton
                  etiqueta={descartado ? 'Volver a dar' : 'El cliente no lo quiso'}
                  tono="neutra"
                  ancho="ajustado"
                  onPress={() => alternarDescarte(r.promocionId)}
                />
              </View>
            );
          })}
        </Tarjeta>
      ) : null}

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
          etiqueta="Número de nota (opcional)"
          value={numNota}
          onChangeText={setNumNota}
          maxLength={LARGO_MAX_NUM_NOTA}
          placeholder="Solo si usaste el block de papel"
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
