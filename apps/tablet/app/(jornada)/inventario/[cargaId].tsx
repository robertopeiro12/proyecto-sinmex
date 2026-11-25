import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import {
  aceptadasDe,
  alternarRenglon,
  crearRespondedorCarga,
  cuerpoRespuesta,
  MENSAJE_CARGA_ELIMINADA,
  palabraPiezas,
  pastillaCarga,
  piezasDeCarga,
  puedeResponder,
  renglonAceptado,
  seleccionarTodos,
  textoAceptar,
  todosSeleccionados,
  type AccionCarga,
  type RespondedorCarga,
} from '@/estado/inventario';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Palomita, Renglon } from '@/ui/checklist';
import { Cifra } from '@/ui/cifra';
import { Icono } from '@/ui/icono';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio } from '@/ui/tokens';

/**
 * Una carga (T-27; rediseño pieza 3, maqueta 4). Pendiente: un checklist de
 * renglones ("Seleccionar todos" o uno por uno), "Aceptar N de M" y "Rechazar
 * todo" (con confirmacion; manda la lista vacia). Sin motivo en ningun caso.
 * La respuesta viaja con red y con la version que se pinta: si el almacen la
 * cambio, el servidor contesta 409 y aqui se ve la nueva (y la seleccion se
 * vacia para volver a revisarla). Ya respondida, se ve que renglones entraron.
 */
/**
 * Al Inventario, no "atras" (recorrido final, D5): desde el aviso de la Ruta,
 * `back` caia en la Ruta. `dismissTo` cierra hasta el Inventario si esta abajo;
 * si no, lo pone en lugar de esta pantalla.
 */
function volverAlInventario() {
  router.dismissTo('/(jornada)/inventario');
}

export default function DetalleCarga() {
  const { cargaId } = useLocalSearchParams<{ cargaId: string }>();
  const { datos, versionCatalogos } = useJawa();
  const { responderCarga, sincronizar } = useSesion();
  const { estilos } = useTema();
  const hoy = datos.deps.reloj.hoy();

  // `versionCatalogos`: la respuesta (200 o 409) y el pull reescriben la carga.
  const carga = useMemo(() => {
    void versionCatalogos;
    return datos.cargas.porId(cargaId);
  }, [datos, cargaId, versionCatalogos]);

  // Guardia de doble toque (Review Focus 3): UN respondedor por pantalla, creado
  // una sola vez (inicializacion perezosa: no se rehace en cada render).
  const respondedorRef = useRef<RespondedorCarga | null>(null);
  if (respondedorRef.current === null) respondedorRef.current = crearRespondedorCarga();
  const respondedor = respondedorRef.current;
  const [enviando, setEnviando] = useState<AccionCarga | null>(null);
  // La seleccion es de UNA version: si el almacen cambia la carga (409 o pull),
  // se vacia sola y el vendedor vuelve a palomear lo que ve.
  const [seleccion, setSeleccion] = useState<{ version: number; ids: ReadonlySet<string> }>({
    version: -1,
    ids: new Set(),
  });
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);

  if (!carga) {
    return (
      <Pantalla titulo="Carga no encontrada" subtitulo="No está en esta tablet.">
        <Boton etiqueta="Volver al inventario" icono="atras" tono="neutra" onPress={volverAlInventario} />
      </Pantalla>
    );
  }

  const respondible = puedeResponder(carga, hoy);
  const pastilla = pastillaCarga(carga);
  const ids = carga.lineas.map((l) => l.presentacion_id);
  const palomeados = seleccion.version === carga.version ? seleccion.ids : new Set<string>();
  const aceptadas = aceptadasDe(carga.lineas, palomeados);
  const cambiarSeleccion = (nuevos: ReadonlySet<string>) => setSeleccion({ version: carga.version, ids: nuevos });

  async function responder(accion: AccionCarga, actual: NonNullable<typeof carga>, lista: readonly string[]) {
    // La version de la carga QUE SE VE (Review Focus 2).
    const cuerpo = cuerpoRespuesta(actual.version, lista);
    // Si el candado ya lo tiene un primer toque, este conserva su estado (no se pisa ni queda colgado).
    setEnviando((previo) => previo ?? accion);
    setAviso(null);
    let resultado: Awaited<ReturnType<RespondedorCarga['responder']>>;
    try {
      resultado = await respondedor.responder({
        responder: () => responderCarga(actual.id, cuerpo),
        aplicar: (respondida) => datos.cargas.aplicarRespuesta(respondida),
        sincronizar,
      });
    } catch {
      // Un paso truena despues de contestar el servidor (escribir la carga en la
      // base local, por ejemplo). El candado ya se solto (`finally` del
      // respondedor) y reenviar la misma respuesta es idempotente en el
      // servidor: se ofrece intentar de nuevo, nunca un boton girando para siempre.
      setEnviando(null);
      setAviso({
        texto: 'No se pudo guardar la respuesta en la tablet. Toca de nuevo para reintentar.',
        error: true,
      });
      return;
    }
    // Segundo toque mientras el primero corre: el primero se encarga de todo.
    if (resultado === null) return;
    setEnviando(null);
    if (resultado.estado === 'respondida') {
      const { carga: respondida } = resultado;
      const entraron = respondida.lineas.filter((l) => l.aceptada !== false).length;
      setAviso({
        texto:
          respondida.estado !== 'aceptada'
            ? 'Rechazaste la carga. No entra nada a tu inventario.'
            : entraron === respondida.lineas.length
              ? 'Carga aceptada. Ya cuenta en tu inventario.'
              : `Aceptaste ${entraron} de ${respondida.lineas.length} productos. Solo esos cuentan en tu inventario.`,
        error: false,
      });
      return;
    }
    setAviso({ texto: resultado.mensaje, error: true });
  }

  function confirmarRechazo(actual: NonNullable<typeof carga>) {
    Alert.alert(
      '¿Rechazar toda la carga?',
      'No entra nada a tu inventario. Si el almacén te la vuelve a mandar, llegará como recarga.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Rechazar todo', style: 'destructive', onPress: () => void responder('rechazar', actual, []) },
      ],
    );
  }

  return (
    <Pantalla
      titulo={`Carga n.º ${carga.numero}`}
      subtitulo={`${carga.fecha} · revisa las piezas con el almacenista`}
    >
      <View style={{ marginBottom: espacio.md }}>
        <Pastilla
          texto={carga.activo === 1 ? pastilla.texto : 'Eliminada'}
          estado={carga.activo === 1 ? pastilla.estado : 'error'}
        />
      </View>

      {respondible ? (
        <>
          <Renglon
            onPress={() => cambiarSeleccion(seleccionarTodos(palomeados, ids))}
            borde={colores.bordeFuerte}
            etiqueta="Seleccionar todos"
            estadoA11y={todosSeleccionados(palomeados, ids)}
          >
            <Palomita encendida={todosSeleccionados(palomeados, ids)} />
            <View style={{ flex: 1 }}>
              <Text style={estilos.textoTarjeta}>Seleccionar todos</Text>
              <Text style={estilos.textoSuave}>
                Carga n.º {carga.numero} · {ids.length === 1 ? '1 producto' : `${ids.length} productos`}
              </Text>
            </View>
          </Renglon>
          {carga.lineas.map((l) => {
            const palomeado = palomeados.has(l.presentacion_id);
            return (
              <Renglon
                key={l.presentacion_id}
                onPress={() => cambiarSeleccion(alternarRenglon(palomeados, l.presentacion_id))}
                borde={palomeado ? colores.exito : colores.borde}
                etiqueta={`${l.etiqueta}, ${l.piezas} ${palabraPiezas(l.piezas)}`}
                estadoA11y={palomeado}
              >
                <Palomita encendida={palomeado} />
                <Text style={[estilos.textoTarjeta, { flex: 1 }]}>{l.etiqueta}</Text>
                <Cifra valor={l.piezas} />
              </Renglon>
            );
          })}
        </>
      ) : (
        <Tarjeta etiqueta="Productos">
          {carga.lineas.map((l) => {
            // Pendiente (de ayer, o eliminada) no marca nada: aun nadie la respondio.
            const marcar = carga.estado !== 'pendiente';
            const entro = renglonAceptado(carga.estado, l);
            return (
              <View
                key={l.presentacion_id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: espacio.sm,
                  marginBottom: espacio.xs,
                }}
              >
                {marcar ? (
                  <View style={{ width: 20, alignItems: 'center' }}>
                    {entro ? <Icono nombre="palomita" tamano={18} color={colores.exito} /> : null}
                  </View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={[estilos.textoTarjeta, marcar && !entro && { color: colores.tintaSuave }]}>
                    {l.etiqueta}
                  </Text>
                  {marcar && !entro ? <Text style={estilos.textoSuave}>No aceptado</Text> : null}
                </View>
                <Cifra valor={l.piezas} tono={marcar && !entro ? 'suave' : undefined} />
              </View>
            );
          })}
          <Text style={[estilos.textoSuave, { marginTop: espacio.xs }]}>
            Total <Cifra valor={piezasDeCarga(carga)} tono="suave" /> {palabraPiezas(piezasDeCarga(carga))}
          </Text>
        </Tarjeta>
      )}

      {carga.estado === 'rechazada' && carga.motivo_rechazo ? (
        <Text style={estilos.error}>La rechazaste: {carga.motivo_rechazo}</Text>
      ) : null}
      {carga.activo === 0 ? (
        <Text style={estilos.error}>El almacén eliminó esta carga: ya no cuenta en tu inventario.</Text>
      ) : null}
      {aviso && !(carga.activo === 0 && aviso.texto === MENSAJE_CARGA_ELIMINADA) ? (
        <Text style={aviso.error ? estilos.error : estilos.textoTarjeta}>{aviso.texto}</Text>
      ) : null}

      {respondible ? (
        // Opuestas en tres ejes (sistema de diseño): Aceptar es confirmar con
        // palomita; Rechazar todo es peligro con tache y pide confirmacion.
        <View style={[estilos.filaAcciones, { marginTop: espacio.lg, marginBottom: espacio.xl }]}>
          <Boton
            etiqueta="Rechazar todo"
            tono="peligro"
            icono="cerrar"
            ocupado={enviando === 'rechazar'}
            deshabilitado={enviando !== null}
            onPress={() => confirmarRechazo(carga)}
          />
          <Boton
            etiqueta={textoAceptar(aceptadas.length, ids.length)}
            tono="confirmar"
            icono="palomita"
            ocupado={enviando === 'aceptar'}
            // Sin palomeados no se acepta: la lista vacia solo sale de "Rechazar todo".
            deshabilitado={aceptadas.length === 0 || enviando !== null}
            onPress={() => void responder('aceptar', carga, aceptadas)}
          />
        </View>
      ) : (
        <Boton
          etiqueta="Volver al inventario"
          tono="neutra"
          icono="atras"
          onPress={volverAlInventario}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      )}
    </Pantalla>
  );
}
