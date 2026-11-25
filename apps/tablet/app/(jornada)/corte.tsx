import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorCorte, ErrorJornada } from '@/datos';
import { leerMontoCentavos } from '@/datos/cobranzas-reglas';
import type { CapturaCorte, SistemaCorte } from '@/datos/repositorios/cortes';
import {
  APARTADOS,
  apartadosDesactualizados,
  capturaParaEnviar,
  corteDisponible,
  efectivoEsperado,
  huellaApartado,
  inventarioCapturado,
  inventarioDelCorte,
  leerPiezas,
  notasDelCorte,
  puedeEnviarCorte,
  resumenDelDia,
  textoApartadoCambio,
  textoFaltanPorVisitar,
  textoMontoCaptura,
  textoNotasQueTraes,
  textoResumenVisitados,
  type Apartado,
  type ResumenDelDia,
} from '@/estado/corte';
import { filasPorRegresar } from '@/estado/inventario';
import { textoConfirmarCierre } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { agruparRutaEnCurso } from '@/estado/ruta-del-dia';
import { contarPendientesDeSubir } from '@/sincronizacion/pendientes';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Palomita, Renglon } from '@/ui/checklist';
import { Cifra, pesos } from '@/ui/cifra';
import { Icono } from '@/ui/icono';
import { MarcoMenu } from '@/ui/marco-menu';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

const CAPTURA_VACIA: CapturaCorte = {
  efectivoTraidoCentavos: null,
  notasTraidas: [],
  inventarioContado: {},
  mermaContada: null,
  cerrados: [],
  huellas: {},
};

const TITULO_APARTADO: Record<Apartado, string> = {
  efectivo: 'Efectivo',
  notas: 'Notas',
  inventario: 'Inventario',
};

const aTextos = (contado: Record<string, number>): Record<string, string> =>
  Object.fromEntries(Object.entries(contado).map(([id, n]) => [id, String(n)]));

/**
 * El Corte del vendedor (rediseño pieza 6, spec §13, maquetas 22–24).
 *
 * Arriba el resumen del dia; abajo tres apartados (Efectivo, Notas,
 * Inventario) que se cierran uno por uno y se pueden reabrir mientras el corte
 * no se envie. Lo capturado se guarda como borrador en cada cambio
 * (`cortes.guardarBorrador`): cerrar la app a medio corte no lo pierde. Con los
 * tres cerrados se enciende **Corte**, que pide el kilometraje final, confirma
 * (`textoConfirmarCierre`) y cierra el dia con el corte en una sola transaccion
 * (`jornadas.cerrarConCorte`). Lo que el sistema espera se calcula **al
 * enviar**, con las reglas puras de `src/estado/corte.ts`.
 *
 * El dia sigue abierto mientras se hace el corte (se puede vender, cobrar,
 * gastar o registrar merma). Al cerrar un apartado se guarda la huella de lo
 * que decia el sistema (`huellaApartado`); si cambia, el apartado se reabre
 * solo con un aviso y Corte se apaga (`apartadosDesactualizados`), al pintar y
 * otra vez al enviar. Los renglones de inventario que el vendedor no corrigio
 * no se congelan: siguen al sistema.
 *
 * El menu apaga Corte con clientes por visitar (`corteDisponible`); si se llega
 * por un enlace directo, la pantalla repite la regla y solo avisa. Con el dia
 * cerrado muestra lo enviado en solo lectura y lo que falta por subir.
 */
export default function Corte() {
  const { datos, jornada, vendedor, versionCatalogos, refrescarJornada } = useJawa();
  const { sincronizar, ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();

  const diaCerrado = jornada?.estado === 'cerrada';

  /**
   * Lo que dice el sistema del dia de la jornada (`jornada.fecha`, no el reloj:
   * abierta pasada la medianoche no lee el dia nuevo, vacio; pieza 6 m-1). Se
   * llama otra vez al enviar, para mandar lo mas nuevo.
   */
  const leerSistema = useCallback(() => {
    if (!vendedor || !jornada) return null;
    const fecha = jornada.fecha;
    const { porVisitar, visitados } = agruparRutaEnCurso(datos.rutas.delDia(vendedor.id, fecha));
    const ventas = datos.ventas.delDiaDelVendedor(vendedor.id, fecha);
    const cobros = datos.cobranzas.delDiaDelVendedor(vendedor.id, fecha);
    const gastos = datos.gastos.delDia(vendedor.id, fecha);
    const asignadas = datos.notasAsignadas.asignadasDeHoy(fecha);
    const queTrae = datos.notasAsignadas.queTraeDelVendedor(vendedor.id, fecha);
    const nombres = new Map<string, string>();
    for (const id of [...asignadas.map((a) => a.clienteId), ...queTrae.map((n) => n.clienteId)]) {
      if (!nombres.has(id)) nombres.set(id, datos.catalogos.obtenerCliente(id)?.nombre ?? '');
    }
    const sistema: SistemaCorte = {
      efectivo: efectivoEsperado({ ventas, cobros, gastos }),
      notas: notasDelCorte({ asignadas, queTrae, cobros, nombres }),
      inventario: inventarioDelCorte(filasPorRegresar(datos.cargas.filasInventario(vendedor.id, fecha))),
    };
    return {
      porVisitar: porVisitar.length,
      // El candado si es del reloj: "¿se pueden abrir clientes ahora?". Pasada
      // la medianoche da `empezar` (no nulo) y Corte no queda con candado.
      candado: datos.cargas.candadoDeHoy(vendedor.id, jornada),
      resumen: resumenDelDia({ ventas, cobros, gastos, porVisitar, visitados }),
      sistema,
    };
  }, [datos, vendedor, jornada]);

  const vista = useMemo(() => {
    void versionCatalogos;
    void ultimaSincronizacion;
    return leerSistema();
  }, [leerSistema, versionCatalogos, ultimaSincronizacion]);

  if (!jornada || !vista) {
    return (
      <MarcoMenu clave="corte" titulo="Corte">
        <Pantalla>
          <Text style={estilos.textoSuave}>Empieza tu ruta para hacer el corte.</Text>
        </Pantalla>
      </MarcoMenu>
    );
  }

  if (diaCerrado) {
    return <CorteEnviado resumen={vista.resumen} />;
  }

  if (!corteDisponible({ porVisitar: vista.porVisitar, candado: vista.candado, diaCerrado })) {
    return (
      <MarcoMenu clave="corte" titulo="Corte">
        <Pantalla>
          <Tarjeta estado="pendiente" etiqueta="Corte">
            <Text style={estilos.textoTarjeta}>{textoFaltanPorVisitar(vista.porVisitar)}</Text>
          </Tarjeta>
        </Pantalla>
      </MarcoMenu>
    );
  }

  return (
    <CapturaDelCorte
      jornadaId={jornada.id}
      kmInicial={jornada.km_inicial}
      resumen={vista.resumen}
      sistema={vista.sistema}
      leerSistema={() => leerSistema()?.sistema ?? null}
      alEnviar={() => {
        // La escritura ya quedo; refrescar o sincronizar no la desmienten.
        refrescarJornada();
        void sincronizar().catch(() => undefined);
      }}
    />
  );
}

/** La captura (maquetas 22–24): resumen, el apartado elegido, pestañas y el boton Corte. */
function CapturaDelCorte({
  jornadaId,
  kmInicial,
  resumen,
  sistema,
  leerSistema,
  alEnviar,
}: {
  jornadaId: string;
  kmInicial: number;
  resumen: ResumenDelDia;
  sistema: SistemaCorte;
  leerSistema: () => SistemaCorte | null;
  alEnviar: () => void;
}) {
  const { datos } = useJawa();
  const { estilos } = useTema();
  const insets = useSafeAreaInsets();

  const [captura, setCaptura] = useState<CapturaCorte>(
    () => datos.cortes.borrador(jornadaId) ?? CAPTURA_VACIA,
  );
  const [efectivoTexto, setEfectivoTexto] = useState(() => textoMontoCaptura(captura.efectivoTraidoCentavos));
  // Solo los campos que el vendedor toco; los demas muestran lo del sistema.
  const [piezas, setPiezas] = useState<Record<string, string>>(() => aTextos(captura.inventarioContado));
  const [mermaTexto, setMermaTexto] = useState<string | undefined>(() =>
    captura.mermaContada === null ? undefined : String(captura.mermaContada),
  );
  const [pestana, setPestana] = useState<Apartado>('efectivo');
  const [error, setError] = useState<string | null>(null);
  const [pidiendoKm, setPidiendoKm] = useState(false);
  const [km, setKm] = useState('');
  // Apartados que se reabrieron solos porque el sistema cambio despues de cerrarlos.
  const [cambiados, setCambiados] = useState<Apartado[]>([]);
  const enviando = useRef(false);

  // Un apartado cerrado cuyo sistema cambio (una venta, un cobro, un gasto o
  // una merma despues de cerrarlo) se pinta abierto, con su aviso, hasta que se
  // vuelva a cerrar (eso guarda la huella nueva). Al enviar se revisa otra vez
  // contra lo mas nuevo y ahi se reabre tambien en el borrador.
  const desactualizados = apartadosDesactualizados(captura, sistema);
  const avisos = APARTADOS.filter((a) => desactualizados.includes(a) || cambiados.includes(a));
  const cerrados = new Set(captura.cerrados.filter((a) => !desactualizados.includes(a)));
  const cerrado = cerrados.has(pestana);

  /** Guarda el borrador; si falla (dia cerrado en otra pantalla, por ejemplo) lo dice. */
  function guardar(parcial: Partial<CapturaCorte>): boolean {
    try {
      setCaptura(datos.cortes.guardarBorrador(jornadaId, parcial));
      return true;
    } catch (e) {
      setError(e instanceof ErrorCorte ? e.message : 'No se pudo guardar el corte en la tablet.');
      return false;
    }
  }

  const cerrar = (apartado: Apartado, parcial: Partial<CapturaCorte> = {}) => {
    setError(null);
    setCambiados((previos) => previos.filter((a) => a !== apartado));
    guardar({
      ...parcial,
      cerrados: [...captura.cerrados.filter((a) => a !== apartado), apartado],
      huellas: { ...captura.huellas, [apartado]: huellaApartado(apartado, sistema) },
    });
  };

  /** Reabre los apartados cerrados cuyo sistema cambio; `true` si reabrio alguno. */
  const reabrirDesactualizados = (actual: SistemaCorte): boolean => {
    const viejos = apartadosDesactualizados(captura, actual);
    if (viejos.length === 0) return false;
    setCambiados((previos) => [...previos.filter((a) => !viejos.includes(a)), ...viejos]);
    guardar({ cerrados: captura.cerrados.filter((a) => !viejos.includes(a)) });
    return true;
  };
  const reabrir = (apartado: Apartado) => {
    setError(null);
    guardar({ cerrados: captura.cerrados.filter((a) => a !== apartado) });
  };

  // --- Efectivo -------------------------------------------------------------
  const efectivoCentavos = leerMontoCentavos(efectivoTexto);
  const cambiarEfectivo = (texto: string) => {
    setEfectivoTexto(texto);
    setError(null);
    if (texto.trim() === '') guardar({ efectivoTraidoCentavos: null });
    else {
      const centavos = leerMontoCentavos(texto);
      if (centavos !== null) guardar({ efectivoTraidoCentavos: centavos });
    }
  };

  // --- Notas ----------------------------------------------------------------
  const palomeadas = new Set(captura.notasTraidas);
  const alternarNota = (clave: string) => {
    const nuevas = palomeadas.has(clave)
      ? captura.notasTraidas.filter((c) => c !== clave)
      : [...captura.notasTraidas, clave];
    guardar({ notasTraidas: nuevas });
  };

  // --- Inventario -----------------------------------------------------------
  const guardarConteos = (textos: Record<string, string>, merma: string | undefined) => {
    const contado: Record<string, number> = {};
    for (const [id, texto] of Object.entries(textos)) {
      const n = leerPiezas(texto);
      if (n !== null) contado[id] = n;
    }
    const mermaContada = merma === undefined ? null : leerPiezas(merma);
    guardar({ inventarioContado: contado, mermaContada });
  };
  const cambiarPiezas = (presentacionId: string, texto: string) => {
    const nuevas = { ...piezas, [presentacionId]: texto };
    setPiezas(nuevas);
    setError(null);
    guardarConteos(nuevas, mermaTexto);
  };
  const cambiarMerma = (texto: string) => {
    setMermaTexto(texto);
    setError(null);
    guardarConteos(piezas, texto);
  };
  const inventarioListo = inventarioCapturado(sistema.inventario, piezas, mermaTexto);
  const cerrarInventario = () => {
    if (!inventarioListo) return;
    // Solo lo corregido; lo demas sigue al sistema y sale con el al enviar (`capturaParaEnviar`).
    cerrar('inventario', inventarioListo);
  };

  // --- Enviar ---------------------------------------------------------------
  const kmNumero = Number(km.replace(',', '.'));
  const kmValido = km.trim() !== '' && Number.isFinite(kmNumero);

  function enviar() {
    if (enviando.current) return;
    enviando.current = true;
    setError(null);
    const actual = leerSistema();
    if (!actual) {
      enviando.current = false;
      return;
    }
    // Si algo cambio desde que se cerro un apartado, se reabre y no se envia.
    if (reabrirDesactualizados(actual)) {
      enviando.current = false;
      setPidiendoKm(false);
      return;
    }
    // La escritura y lo que sigue van separados: si refrescar o sincronizar
    // fallan, el dia YA esta cerrado y el corte guardado (T-38: un fallo al
    // refrescar no puede decir "no se cerro" con el dia ya cerrado).
    try {
      datos.jornadas.cerrarConCorte(jornadaId, kmNumero, {
        captura: capturaParaEnviar(captura, actual.inventario),
        sistema: actual,
      });
    } catch (e) {
      enviando.current = false;
      setError(
        e instanceof ErrorJornada || e instanceof ErrorCorte ? e.message : 'No se pudo enviar el corte.',
      );
      return;
    }
    alEnviar();
  }

  function confirmarEnvio() {
    setError(null);
    if (kmNumero < kmInicial) {
      setError(`El kilometraje final (${kmNumero}) no puede ser menor al inicial (${kmInicial}).`);
      return;
    }
    Alert.alert('Cerrar el día', textoConfirmarCierre(kmNumero), [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar el día', style: 'destructive', onPress: enviar },
    ]);
  }

  if (pidiendoKm) {
    return (
      <MarcoMenu clave="corte" titulo="Corte">
        <Pantalla
          formulario
          subtitulo={
            <Text style={estilos.subtitulo}>
              Para enviar el corte captura el kilometraje final. Abriste el día con{' '}
              <Cifra valor={kmInicial} tono="suave" /> km.
            </Text>
          }
        >
          <Campo
            etiqueta="Kilometraje final"
            cifra
            // Ver la nota gemela en `src/ui/tarjeta-empezar-ruta.tsx`: el odometro puede traer decimal.
            keyboardType="numeric"
            inputMode="decimal"
            value={km}
            onChangeText={(texto) => {
              setKm(texto);
              setError(null);
            }}
            placeholder={`Mayor o igual a ${kmInicial}`}
          />
          {error ? <Text style={estilos.error}>{error}</Text> : null}
          <Boton
            etiqueta="Enviar corte"
            icono="corte"
            onPress={confirmarEnvio}
            deshabilitado={!kmValido}
            estilo={{ marginTop: espacio.lg }}
          />
          <Boton
            etiqueta="Regresar al corte"
            tono="neutra"
            icono="atras"
            onPress={() => {
              setPidiendoKm(false);
              setError(null);
            }}
            estilo={{ marginTop: espacio.sm }}
          />
        </Pantalla>
      </MarcoMenu>
    );
  }

  const puedeEnviar = puedeEnviarCorte(cerrados);

  return (
    <MarcoMenu clave="corte" titulo="Corte">
      <View style={{ flex: 1, backgroundColor: colores.papel }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[estilos.contenido, { paddingBottom: espacio.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          <TarjetaResumen resumen={resumen} />

          {avisos.map((a) => (
            <Tarjeta key={a} estado="pendiente">
              <Text style={estilos.textoTarjeta}>{textoApartadoCambio(a)}</Text>
            </Tarjeta>
          ))}

          {pestana === 'efectivo' ? (
            <>
              <Encabezado titulo="Efectivo" cerrado={cerrado} />
              <Tarjeta>
                <Kv etiqueta="Ventas de contado" valor={pesos(sistema.efectivo.contadoCentavos)} />
                <Kv etiqueta="Abonos y cobros" valor={pesos(sistema.efectivo.abonosYCobrosCentavos)} />
                <Kv etiqueta="Menos gastos" valor={`−${pesos(sistema.efectivo.gastosCentavos)}`} />
                <Kv etiqueta="Debes traer" valor={pesos(sistema.efectivo.debeTraerCentavos)} grande />
                {sistema.efectivo.otrosMetodosCentavos > 0 ? (
                  <Text style={estilos.textoSuave}>
                    Cobros en transferencia / cheque: {pesos(sistema.efectivo.otrosMetodosCentavos)} (no son
                    efectivo).
                  </Text>
                ) : null}
              </Tarjeta>
              <Campo
                etiqueta="¿Cuánto traes?"
                cifra
                keyboardType="decimal-pad"
                inputMode="decimal"
                value={efectivoTexto}
                onChangeText={cambiarEfectivo}
                placeholder="$ 0.00"
                editable={!cerrado}
                invalido={efectivoTexto.trim() !== '' && efectivoCentavos === null}
              />
              {cerrado ? (
                <Boton etiqueta="Reabrir efectivo" tono="neutra" onPress={() => reabrir('efectivo')} />
              ) : (
                <Boton
                  etiqueta="Cerrar efectivo"
                  tono="neutra"
                  icono="palomita"
                  deshabilitado={efectivoCentavos === null}
                  onPress={() =>
                    efectivoCentavos !== null && cerrar('efectivo', { efectivoTraidoCentavos: efectivoCentavos })
                  }
                />
              )}
            </>
          ) : null}

          {pestana === 'notas' ? (
            <>
              <Encabezado
                titulo="Notas que traes"
                derecha={textoNotasQueTraes(sistema.notas, palomeadas)}
                cerrado={cerrado}
              />
              {sistema.notas.length === 0 ? (
                <Text style={estilos.textoSuave}>Hoy no traes notas.</Text>
              ) : (
                sistema.notas.map((n) => {
                  const encendida = palomeadas.has(n.clave);
                  return (
                    <Renglon
                      key={n.clave}
                      etiqueta={`Nota ${n.folio}, ${n.cliente}, ${n.detalle}, ${n.montoTexto}`}
                      borde={encendida ? colores.exito : colores.borde}
                      estadoA11y={encendida}
                      onPress={() => {
                        if (!cerrado) alternarNota(n.clave);
                      }}
                    >
                      <Palomita encendida={encendida} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...estiloFuerte, fontSize: 18 }}>
                          Nota <Cifra valor={n.folio} />
                        </Text>
                        <Text style={estilos.textoSuave}>
                          {n.cliente ? `${n.cliente} · ` : ''}
                          {n.detalle}
                        </Text>
                      </View>
                      <Cifra valor={n.montoTexto} />
                    </Renglon>
                  );
                })
              )}
              {cerrado ? (
                <Boton
                  etiqueta="Reabrir notas"
                  tono="neutra"
                  onPress={() => reabrir('notas')}
                  estilo={{ marginTop: espacio.sm }}
                />
              ) : (
                <Boton
                  etiqueta="Cerrar notas"
                  tono="neutra"
                  icono="palomita"
                  onPress={() => cerrar('notas')}
                  estilo={{ marginTop: espacio.sm }}
                />
              )}
            </>
          ) : null}

          {pestana === 'inventario' ? (
            <>
              <Encabezado titulo="Inventario que regresas" cerrado={cerrado} />
              {sistema.inventario.renglones.map((r) => (
                <RenglonConteo
                  key={r.presentacionId}
                  titulo={r.etiqueta}
                  sistema={r.sistema}
                  valor={piezas[r.presentacionId] ?? String(r.sistema)}
                  onCambiar={(texto) => cambiarPiezas(r.presentacionId, texto)}
                  editable={!cerrado}
                />
              ))}
              <RenglonConteo
                titulo="Merma"
                sistema={sistema.inventario.mermaSistema}
                valor={mermaTexto ?? String(sistema.inventario.mermaSistema)}
                onCambiar={cambiarMerma}
                editable={!cerrado}
                hundido
              />
              {cerrado ? (
                <Boton
                  etiqueta="Reabrir inventario"
                  tono="neutra"
                  onPress={() => reabrir('inventario')}
                  estilo={{ marginTop: espacio.sm }}
                />
              ) : (
                <Boton
                  etiqueta="Cerrar inventario"
                  tono="neutra"
                  icono="palomita"
                  deshabilitado={!inventarioListo}
                  onPress={cerrarInventario}
                  estilo={{ marginTop: espacio.sm }}
                />
              )}
            </>
          ) : null}

          {error ? <Text style={estilos.error}>{error}</Text> : null}
        </ScrollView>

        <Pestanas elegida={pestana} cerrados={cerrados} onElegir={setPestana} />

        <View
          style={{
            paddingHorizontal: espacio.md,
            paddingTop: espacio.sm,
            paddingBottom: espacio.sm + insets.bottom,
            backgroundColor: colores.superficie,
            borderTopWidth: grosor.hairline,
            borderTopColor: colores.borde,
          }}
        >
          <Boton
            etiqueta="Corte"
            icono={puedeEnviar ? 'corte' : 'candado'}
            deshabilitado={!puedeEnviar}
            onPress={() => {
              setError(null);
              setPidiendoKm(true);
            }}
          />
        </View>
      </View>
    </MarcoMenu>
  );
}

/** El dia ya cerrado: lo enviado, en solo lectura, y lo que falta por subir. */
function CorteEnviado({ resumen }: { resumen: ResumenDelDia }) {
  const { datos, jornada, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();

  const { corte, pendientes } = useMemo(() => {
    void versionCatalogos;
    void ultimaSincronizacion;
    return {
      corte: jornada ? datos.cortes.deJornada(jornada.id) : null,
      // Suma todas las fuentes del push: el dia no esta "listo" con algo sin subir.
      pendientes: contarPendientesDeSubir(datos),
    };
  }, [datos, jornada, versionCatalogos, ultimaSincronizacion]);

  const sistema = corte?.sistema ?? null;
  const captura = corte?.captura ?? null;
  const subida =
    corte === null
      ? null
      : corte.syncEstado === 'sincronizado'
        ? { texto: 'Corte subido', estado: 'listo' as const }
        : corte.syncEstado === 'error'
          ? { texto: 'Corte con error al subir', estado: 'error' as const }
          : { texto: 'Corte por subir', estado: 'pendiente' as const };

  return (
    <MarcoMenu clave="corte" titulo="Corte">
      <Pantalla
        subtitulo={
          jornada ? (
            <Text style={estilos.subtitulo}>
              Día cerrado. Kilometraje <Cifra valor={jornada.km_inicial} tono="suave" /> →{' '}
              <Cifra valor={jornada.km_final ?? 0} tono="suave" /> (
              <Cifra valor={(jornada.km_final ?? 0) - jornada.km_inicial} tono="suave" /> km recorridos).
            </Text>
          ) : undefined
        }
      >
        <TarjetaResumen resumen={resumen} />

        {sistema && captura ? (
          <>
            <Encabezado titulo="Efectivo" cerrado />
            <Tarjeta>
              <Kv etiqueta="Debías traer" valor={pesos(sistema.efectivo.debeTraerCentavos)} />
              <Kv etiqueta="Trajiste" valor={pesos(captura.efectivoTraidoCentavos ?? 0)} grande />
            </Tarjeta>

            <Encabezado
              titulo="Notas que traes"
              derecha={textoNotasQueTraes(sistema.notas, new Set(captura.notasTraidas))}
              cerrado
            />
            {sistema.notas.length > 0 ? (
              <Tarjeta>
                {sistema.notas.map((n) => (
                  <View key={n.clave} style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.sm }}>
                    <Palomita encendida={captura.notasTraidas.includes(n.clave)} />
                    <Text style={[estilos.textoSuave, { flex: 1 }]}>
                      Nota {n.folio}
                      {n.cliente ? ` · ${n.cliente}` : ''} · {n.detalle}
                    </Text>
                    <Cifra valor={n.montoTexto} />
                  </View>
                ))}
              </Tarjeta>
            ) : null}

            <Encabezado titulo="Inventario que regresas" cerrado />
            <Tarjeta>
              {sistema.inventario.renglones.map((r) => (
                <Kv
                  key={r.presentacionId}
                  etiqueta={`${r.etiqueta} · Sistema: ${r.sistema}`}
                  valor={String(captura.inventarioContado[r.presentacionId] ?? r.sistema)}
                />
              ))}
              <Kv
                etiqueta={`Merma · Sistema: ${sistema.inventario.mermaSistema}`}
                valor={String(captura.mermaContada ?? sistema.inventario.mermaSistema)}
              />
            </Tarjeta>
          </>
        ) : null}

        <Tarjeta estado={pendientes > 0 ? 'pendiente' : 'listo'} etiqueta="Sincronización">
          {subida ? <Pastilla texto={subida.texto} estado={subida.estado} /> : null}
          <View style={{ marginTop: espacio.sm }}>
            <Pastilla
              numero={pendientes}
              texto={pendientes === 1 ? 'registro esperando WiFi' : 'registros esperando WiFi'}
              estado={pendientes > 0 ? 'pendiente' : 'listo'}
            />
          </View>
          <Text style={estilos.textoSuave}>
            Suben solos al volver al WiFi del negocio, o con «Sincronizar ahora» desde la Ruta.
          </Text>
        </Tarjeta>
      </Pantalla>
    </MarcoMenu>
  );
}

const estiloFuerte = { fontFamily: fuente.cuerpoFuerte, color: colores.tinta } as const;

/** "Resumen del día · 6 de 6 visitados" con Ventas, Cobranza y Gastos (maquetas 22–24). */
function TarjetaResumen({ resumen }: { resumen: ResumenDelDia }) {
  const { estilos } = useTema();
  return (
    <Tarjeta>
      <Text style={estilos.etiqueta}>{textoResumenVisitados(resumen)}</Text>
      <Kv etiqueta="Ventas" valor={pesos(resumen.ventasCentavos)} />
      <Kv etiqueta="Cobranza" valor={pesos(resumen.cobranzaCentavos)} />
      <Kv etiqueta="Gastos" valor={pesos(resumen.gastosCentavos)} />
    </Tarjeta>
  );
}

/** Una fila etiqueta / valor (`kv` de las maquetas); `grande` es "Debes traer". */
function Kv({ etiqueta, valor, grande = false }: { etiqueta: string; valor: string; grande?: boolean }) {
  const { t } = useTema();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: espacio.sm,
        paddingVertical: espacio.xs,
        ...(grande
          ? { marginTop: espacio.xs, paddingTop: espacio.sm, borderTopWidth: grosor.hairline, borderTopColor: colores.borde }
          : {}),
      }}
    >
      <Text
        style={{
          flex: 1,
          fontFamily: grande ? fuente.cuerpoFuerte : fuente.cuerpo,
          fontSize: t(grande ? tipo.destacado : tipo.cuerpo),
          color: grande ? colores.tinta : colores.tintaSuave,
        }}
      >
        {etiqueta}
      </Text>
      <Cifra valor={valor} tamano={grande ? 'destacado' : 'cuerpo'} />
    </View>
  );
}

/** El encabezado de un apartado (`sech`): titulo, un dato a la derecha y "Cerrado". */
function Encabezado({ titulo, derecha, cerrado }: { titulo: string; derecha?: string; cerrado: boolean }) {
  const { estilos } = useTema();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: espacio.sm }}>
      <Text style={[estilos.seccion, { flex: 1 }]}>{titulo}</Text>
      {derecha ? <Cifra valor={derecha} tono="suave" /> : null}
      {cerrado ? <Text style={{ fontFamily: fuente.cuerpoFuerte, color: colores.exito }}>Cerrado</Text> : null}
    </View>
  );
}

/** Un renglon del inventario: producto, "Sistema: 8" y el campo prellenado con ese numero. */
function RenglonConteo({
  titulo,
  sistema,
  valor,
  onCambiar,
  editable,
  hundido = false,
}: {
  titulo: string;
  sistema: number;
  valor: string;
  onCambiar: (texto: string) => void;
  editable: boolean;
  hundido?: boolean;
}) {
  const { estilos, t, dispositivo } = useTema();
  const invalido = leerPiezas(valor) === null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: espacio.sm,
        padding: espacio.sm,
        marginBottom: espacio.sm,
        borderRadius: radio.medio,
        borderWidth: grosor.hairline,
        borderColor: colores.borde,
        backgroundColor: hundido ? colores.superficieHundida : colores.superficie,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ ...estiloFuerte, fontSize: t(tipo.cuerpo) }}>{titulo}</Text>
        <Text style={[estilos.textoSuave, { marginTop: 0 }]}>Sistema: {sistema}</Text>
      </View>
      <TextInput
        accessibilityLabel={`${titulo}, piezas que regresas`}
        value={valor}
        onChangeText={onCambiar}
        editable={editable}
        keyboardType="number-pad"
        inputMode="numeric"
        selectTextOnFocus
        style={[
          estilos.campo,
          estilos.campoCifra,
          {
            width: 96,
            minHeight: dispositivo.tactil,
            marginBottom: 0,
            textAlign: 'center',
            opacity: editable ? 1 : 0.7,
          },
          invalido && estilos.campoInvalido,
        ]}
      />
    </View>
  );
}

/** Las pestañas de abajo (`nav2`): el apartado elegido y la palomita de los cerrados. */
function Pestanas({
  elegida,
  cerrados,
  onElegir,
}: {
  elegida: Apartado;
  cerrados: ReadonlySet<Apartado>;
  onElegir: (a: Apartado) => void;
}): ReactNode {
  const { t, dispositivo } = useTema();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colores.superficie,
        borderTopWidth: grosor.fuerte,
        borderTopColor: colores.bordeFuerte,
      }}
    >
      {APARTADOS.map((a) => {
        const on = a === elegida;
        const ok = cerrados.has(a);
        const color = on ? colores.primario : ok ? colores.exito : colores.tinta;
        return (
          <Pressable
            key={a}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${TITULO_APARTADO[a]}${ok ? ', cerrado' : ''}`}
            onPress={() => onElegir(a)}
            style={{
              flex: 1,
              minHeight: Math.min(dispositivo.tactil, 52),
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: espacio.xs,
              backgroundColor: on ? colores.primarioTenue : colores.superficie,
              borderBottomWidth: grosor.acento,
              borderBottomColor: on ? colores.primario : 'transparent',
            }}
          >
            {ok ? <Icono nombre="palomita" tamano={16} color={color} /> : null}
            <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.cuerpo), color }}>
              {TITULO_APARTADO[a]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
