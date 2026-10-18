import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Text, ToastAndroid } from 'react-native';

import { ErrorJornada, ErrorVisita } from '@/datos';
import type { MotivoVisita } from '@/datos/tipos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { textoUbicacionVisita, validarVisita, type UbicacionVisita } from '@/estado/visita';
import type { FotoComprimida } from '@/fotos/comprimir';
import { capturarFoto } from '@/fotos/expo';
import { obtenerUbicacion } from '@/ubicacion/obtener';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/** El aviso breve al volver a la ruta (como "Agregar a mi ruta"). En otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * Visita sin venta (T-39, D7): por que el cliente no compro. Motivo del catalogo
 * de la oficina, observaciones, quien atendio (obligatorio si el motivo lo exige),
 * foto (obligatoria si el motivo la exige) y ubicacion (GPS o, sin el, la
 * direccion escrita). Funciona sin red. Toda la validacion es `validarVisita`
 * (`src/estado/visita.ts`, con pruebas); aqui solo se pinta.
 */
export default function VisitaSinVenta() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const motivos = useMemo<MotivoVisita[]>(() => {
    void versionCatalogos;
    return datos.catalogos.listarMotivosVisita();
  }, [datos, versionCatalogos]);

  const [motivoId, setMotivoId] = useState<string | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [atendio, setAtendio] = useState('');
  const [direccion, setDireccion] = useState('');
  const [foto, setFoto] = useState<FotoComprimida | null>(null);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const [camaraNegada, setCamaraNegada] = useState(false);
  const [tomandoFoto, setTomandoFoto] = useState(false);
  const [ubicacion, setUbicacion] = useState<UbicacionVisita>({ estado: 'buscando' });
  const [error, setError] = useState<string | null>(null);
  const montada = useRef(true);
  // Guardia contra doble toque: `registrar()` genera un id nuevo cada vez y
  // `dismissTo` deja la pantalla montada durante la transicion, asi que un
  // segundo toque en cola grabaria otra visita. El ref corta en el mismo tick;
  // el estado deshabilita el boton.
  const guardando = useRef(false);
  const [guardada, setGuardada] = useState(false);

  // El motivo elegido se lee por id, activo o no: si el pull lo da de baja con la
  // pantalla abierta, la visita se guarda igual (D3, Review Focus 1).
  const motivo = useMemo(() => {
    void versionCatalogos;
    return motivoId === null ? null : datos.catalogos.obtenerMotivoVisita(motivoId);
  }, [datos, motivoId, versionCatalogos]);

  const validacion = validarVisita({
    motivo,
    observaciones,
    atendio,
    fotoUri: foto?.uri ?? null,
    ubicacion,
    direccionTexto: direccion,
  });

  // D7.1: al abrir empieza a pedir la ubicacion (10 s, nunca lanza), para que el
  // punto ya este listo al guardar. Solo escribe el estado DESPUES de la espera
  // (el inicial ya es "buscando"); el reintento pone "buscando" en `reintentarUbicacion`.
  const pedirUbicacion = useCallback(async () => {
    const r = await obtenerUbicacion();
    if (!montada.current) return;
    setUbicacion(
      r.estado === 'ok'
        ? { estado: 'ok', lat: r.lat, lng: r.lng, precisionM: r.precisionM }
        : { estado: 'fallo', permisoNegado: r.estado === 'permiso-negado' },
    );
  }, []);

  useEffect(() => {
    montada.current = true;
    void pedirUbicacion();
    return () => {
      montada.current = false;
    };
  }, [pedirUbicacion]);

  function reintentarUbicacion() {
    setUbicacion({ estado: 'buscando' });
    void pedirUbicacion();
  }

  async function tomarFoto() {
    setAvisoFoto(null);
    setTomandoFoto(true);
    try {
      const r = await capturarFoto('visita');
      if (r.estado === 'ok') {
        setFoto(r.foto);
        setCamaraNegada(false);
        if (!r.foto.objetivoAlcanzado) setAvisoFoto('La foto quedó más pesada de lo normal; va a subir igual.');
        return;
      }
      if (r.estado === 'cancelado') return;
      if (r.estado === 'permiso-negado') {
        setCamaraNegada(true);
        setAvisoFoto(
          validacion.fotoObligatoria
            ? 'Sin permiso de cámara. Este motivo exige foto: dale permiso en los ajustes para poder guardar.'
            : 'Sin permiso de cámara. La foto queda pendiente; puedes guardar sin ella.',
        );
        return;
      }
      setAvisoFoto('No se pudo preparar la foto. Vuelve a intentarlo.');
    } finally {
      setTomandoFoto(false);
    }
  }

  function guardar() {
    setError(null);
    if (!vendedor) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    if (validacion.visita === null) return;
    if (guardando.current) return;
    guardando.current = true;
    setGuardada(true);
    try {
      datos.visitas.registrar({ vendedorId: vendedor.id, clienteId, ...validacion.visita });
      avisar('Visita registrada');
      // D7.7: regresa a la ruta del dia, donde el cliente ya sale en "Visitados sin venta".
      router.dismissTo('/(jornada)');
    } catch (e) {
      guardando.current = false;
      setGuardada(false);
      setError(e instanceof ErrorVisita || e instanceof ErrorJornada ? e.message : 'No se pudo guardar la visita.');
    }
  }

  const cliente = datos.catalogos.obtenerCliente(clienteId);
  if (!cliente) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        <Text style={estilos.textoSuave}>Sincroniza y vuelve a abrir su ficha.</Text>
      </Pantalla>
    );
  }

  return (
    <Pantalla titulo="Visita sin venta" subtitulo={`${cliente.nombre} · registra por qué no compró`}>
      {motivos.length === 0 ? (
        // Sin catalogo local (nunca ha sincronizado): lo dice y no deja guardar.
        <Tarjeta estado="pendiente" etiqueta="Sin catálogo de motivos">
          <Text style={estilos.textoTarjeta}>
            Los motivos bajan del portal con la sincronización. Sincroniza para poder registrar la visita.
          </Text>
        </Tarjeta>
      ) : (
        <>
          <Text style={estilos.etiqueta}>Motivo</Text>
          {motivos.map((m) => (
            <Opcion
              key={m.id}
              etiqueta={m.nombre}
              seleccionada={m.id === motivoId}
              onPress={() => setMotivoId(m.id)}
            />
          ))}

          <Campo
            etiqueta="Observaciones"
            value={observaciones}
            onChangeText={setObservaciones}
            placeholder="Lo que haya que recordar (opcional)"
            maxLength={500}
            multiline
          />

          <Campo
            etiqueta={validacion.atendioObligatorio ? 'Quién atendió (obligatorio)' : 'Quién atendió (opcional)'}
            value={atendio}
            onChangeText={setAtendio}
            placeholder="Nombre de quien atendió"
            maxLength={120}
            autoCapitalize="words"
            invalido={validacion.atendioObligatorio && atendio.trim() === ''}
          />

          <Tarjeta
            estado={foto ? 'listo' : validacion.fotoObligatoria ? 'pendiente' : 'neutro'}
            etiqueta={validacion.fotoObligatoria ? 'Foto (obligatoria)' : 'Foto (opcional)'}
          >
            {foto ? <Pastilla texto="foto tomada" estado="listo" /> : null}
            <Boton
              etiqueta={foto ? 'Volver a tomar' : 'Tomar foto'}
              tono="neutra"
              glifo="◉"
              onPress={() => void tomarFoto()}
              ocupado={tomandoFoto}
              estilo={{ marginTop: espacio.sm }}
            />
            {avisoFoto ? <Text style={estilos.textoSuave}>{avisoFoto}</Text> : null}
            {camaraNegada ? (
              <Boton
                etiqueta="Abrir ajustes"
                tono="neutra"
                ancho="ajustado"
                onPress={() => void Linking.openSettings()}
                estilo={{ marginTop: espacio.sm }}
              />
            ) : null}
          </Tarjeta>

          <Tarjeta
            estado={ubicacion.estado === 'ok' ? 'listo' : ubicacion.estado === 'fallo' ? 'pendiente' : 'neutro'}
            etiqueta="Ubicación"
          >
            <Pastilla
              texto={textoUbicacionVisita(ubicacion)}
              estado={ubicacion.estado === 'ok' ? 'listo' : ubicacion.estado === 'fallo' ? 'pendiente' : 'neutro'}
            />
            {ubicacion.estado === 'fallo' ? (
              <Boton
                etiqueta="Volver a intentar"
                tono="neutra"
                glifo="⌖"
                ancho="ajustado"
                onPress={reintentarUbicacion}
                estilo={{ marginTop: espacio.sm }}
              />
            ) : null}
            {validacion.pedirDireccion ? (
              <Campo
                etiqueta="Dirección o referencia"
                value={direccion}
                onChangeText={setDireccion}
                placeholder="Calle, número o una referencia del lugar"
                maxLength={300}
                invalido={ubicacion.estado !== 'ok' && direccion.trim() === ''}
              />
            ) : null}
          </Tarjeta>
        </>
      )}

      {validacion.faltantes.length > 0 && motivos.length > 0 ? (
        <Text style={estilos.textoSuave}>{validacion.faltantes.join(' ')}</Text>
      ) : null}
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta="Guardar visita"
        glifo="✓"
        deshabilitado={validacion.visita === null || !menu.operacionesHabilitadas || guardada}
        onPress={guardar}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
