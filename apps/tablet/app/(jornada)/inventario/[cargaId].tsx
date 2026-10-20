import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import {
  crearRespondedorCarga,
  cuerpoRespuesta,
  LARGO_MAX_MOTIVO_RECHAZO,
  MENSAJE_CARGA_ELIMINADA,
  pastillaCarga,
  puedeResponder,
  totalPiezas,
  validarRespuesta,
  type AccionCarga,
  type RespondedorCarga,
} from '@/estado/inventario';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Una carga (T-27, D2/D6): sus lineas y, si esta pendiente, Aceptar o Rechazar
 * (con motivo). La respuesta viaja con red y con la version que se pinta: si el
 * almacen la cambio, el servidor contesta 409 y aqui se ve la nueva. Sin red no
 * se acepta.
 */
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
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);

  if (!carga) {
    return (
      <Pantalla titulo="Carga no encontrada" subtitulo="No está en esta tablet.">
        <Boton etiqueta="Volver al inventario" glifo="←" tono="neutra" onPress={() => router.back()} />
      </Pantalla>
    );
  }

  const respondible = puedeResponder(carga, hoy);
  const pastilla = pastillaCarga(carga.estado);

  async function responder(accion: AccionCarga, actual: NonNullable<typeof carga>) {
    const problemas = validarRespuesta(accion, motivo);
    if (problemas.length > 0) {
      setAviso({ texto: problemas.join(' '), error: true });
      return;
    }
    // La version de la carga QUE SE VE (Review Focus 2).
    const cuerpo = cuerpoRespuesta(accion, motivo, actual.version);
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
      setRechazando(false);
      setMotivo('');
      setAviso({
        texto:
          resultado.carga.estado === 'aceptada'
            ? 'Carga aceptada. Ya cuenta en tu inventario.'
            : 'Carga rechazada. El almacén la corregirá y te la volverá a mandar.',
        error: false,
      });
      return;
    }
    setAviso({ texto: resultado.mensaje, error: true });
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

      <Tarjeta etiqueta="Productos">
        {carga.lineas.map((l) => (
          <View
            key={l.presentacion_id}
            style={{ flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm, marginBottom: espacio.xs }}
          >
            <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{l.etiqueta}</Text>
            <Cifra valor={l.piezas} />
          </View>
        ))}
      </Tarjeta>

      <Tarjeta estado="accion" etiqueta="Total">
        <Cifra valor={totalPiezas(carga.lineas)} tamano="destacado" />
        <Text style={estilos.textoSuave}>piezas</Text>
      </Tarjeta>

      {carga.estado === 'rechazada' && carga.motivo_rechazo ? (
        <Text style={estilos.error}>La rechazaste: {carga.motivo_rechazo}</Text>
      ) : null}
      {carga.activo === 0 ? (
        <Text style={estilos.error}>El almacén eliminó esta carga: ya no cuenta en tu inventario.</Text>
      ) : null}
      {aviso && !(carga.activo === 0 && aviso.texto === MENSAJE_CARGA_ELIMINADA) ? <Text style={aviso.error ? estilos.error : estilos.textoTarjeta}>{aviso.texto}</Text> : null}

      {respondible && rechazando ? (
        <Tarjeta estado="error" etiqueta="Rechazar la carga">
          <Campo
            etiqueta="¿Por qué la rechazas?"
            value={motivo}
            onChangeText={setMotivo}
            maxLength={LARGO_MAX_MOTIVO_RECHAZO}
            multiline
            editable={enviando === null}
          />
          <View style={estilos.filaAcciones}>
            <Boton
              etiqueta="Volver"
              tono="neutra"
              glifo="←"
              deshabilitado={enviando !== null}
              onPress={() => {
                setRechazando(false);
                setAviso(null);
              }}
            />
            <Boton
              etiqueta="Enviar rechazo"
              tono="peligro"
              glifo="×"
              ocupado={enviando === 'rechazar'}
              onPress={() => void responder('rechazar', carga)}
            />
          </View>
        </Tarjeta>
      ) : null}

      {respondible && !rechazando ? (
        // Opuestas en tres ejes (sistema de diseño): Aceptar es confirmar con ✓;
        // Rechazar es peligro con ×.
        <View style={[estilos.filaAcciones, { marginTop: espacio.lg, marginBottom: espacio.xl }]}>
          <Boton
            etiqueta="Rechazar"
            tono="peligro"
            glifo="×"
            deshabilitado={enviando !== null}
            onPress={() => {
              setRechazando(true);
              setAviso(null);
            }}
          />
          <Boton
            etiqueta="Aceptar"
            tono="confirmar"
            glifo="✓"
            ocupado={enviando === 'aceptar'}
            onPress={() => void responder('aceptar', carga)}
          />
        </View>
      ) : null}

      {!respondible ? (
        <Boton
          etiqueta="Volver al inventario"
          tono="neutra"
          glifo="←"
          onPress={() => router.back()}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      ) : null}
    </Pantalla>
  );
}
