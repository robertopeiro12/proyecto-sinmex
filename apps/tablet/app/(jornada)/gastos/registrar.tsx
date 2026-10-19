import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Text, ToastAndroid } from 'react-native';

import { ErrorGasto, ErrorJornada, LARGO_MAX_COMENTARIO_GASTO } from '@/datos';
import type { CampoEgreso } from '@/datos/tipos';
import {
  camposParaGasto,
  faltantesVisiblesGasto,
  puedeGuardarGasto,
  TEXTO_METODO_GASTO,
  validarGasto,
} from '@/estado/gasto';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import type { FotoComprimida } from '@/fotos/comprimir';
import { capturarFoto } from '@/fotos/expo';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/** El aviso breve al volver a la lista (como "Visita registrada"). En otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * Registrar gasto (T-30/T-31, D9): campo (los activos con "Se usa en la app"),
 * monto en pesos, observaciones (opcionales, hasta 200) y foto del ticket
 * (opcional). El metodo se muestra fijo. Funciona sin red. Toda la validacion es
 * `validarGasto` (`src/estado/gasto.ts`, con pruebas); aqui solo se pinta.
 */
export default function RegistrarGasto() {
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const campos = useMemo<CampoEgreso[]>(() => {
    void versionCatalogos;
    return camposParaGasto(datos.catalogos.listarCamposEgreso());
  }, [datos, versionCatalogos]);

  const [campoId, setCampoId] = useState<string | null>(null);
  const [monto, setMonto] = useState('');
  const [comentario, setComentario] = useState('');
  const [foto, setFoto] = useState<FotoComprimida | null>(null);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const [camaraNegada, setCamaraNegada] = useState(false);
  const [tomandoFoto, setTomandoFoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guardia contra doble toque (leccion de T-39): `registrar()` genera un id
  // nuevo cada vez y `router.back()` deja la pantalla montada durante la
  // transicion, asi que un segundo toque en cola grabaria otro gasto. El ref
  // corta en el mismo tick; el estado deshabilita el boton.
  const guardando = useRef(false);
  const [guardado, setGuardado] = useState(false);

  // El campo elegido se lee por id, activo o no: si el pull lo da de baja o le
  // quita la casilla con la pantalla abierta, el gasto se guarda igual (D5).
  const campo = useMemo(() => {
    void versionCatalogos;
    return campoId === null ? null : datos.catalogos.obtenerCampoEgreso(campoId);
  }, [datos, campoId, versionCatalogos]);

  const entrada = {
    campo,
    monto,
    comentario,
    fotoUri: foto?.uri ?? null,
    diaCerrado: !menu.operacionesHabilitadas,
  };
  const validacion = validarGasto(entrada);
  const faltantes = faltantesVisiblesGasto(entrada, validacion);

  async function tomarFoto() {
    setAvisoFoto(null);
    setTomandoFoto(true);
    try {
      const r = await capturarFoto('gasto');
      if (r.estado === 'ok') {
        setFoto(r.foto);
        setCamaraNegada(false);
        if (!r.foto.objetivoAlcanzado) setAvisoFoto('La foto quedó más pesada de lo normal; va a subir igual.');
        return;
      }
      if (r.estado === 'cancelado') return;
      if (r.estado === 'permiso-negado') {
        setCamaraNegada(true);
        setAvisoFoto('Sin permiso de cámara. La foto es opcional: puedes guardar el gasto sin ella.');
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
    if (validacion.gasto === null || tomandoFoto) return;
    if (guardando.current) return;
    guardando.current = true;
    setGuardado(true);
    try {
      datos.gastos.registrar({ vendedorId: vendedor.id, ...validacion.gasto });
      avisar('Gasto registrado');
      router.back();
    } catch (e) {
      // Solo el error suelta la guardia: el gasto no se grabo y se puede reintentar.
      guardando.current = false;
      setGuardado(false);
      setError(e instanceof ErrorGasto || e instanceof ErrorJornada ? e.message : 'No se pudo guardar el gasto.');
    }
  }

  return (
    <Pantalla titulo="Registrar gasto" subtitulo="Se paga con la cobranza del día">
      {campos.length === 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Sin catálogo de gastos">
          <Text style={estilos.textoTarjeta}>
            Los campos de gasto bajan del portal con la sincronización. Sincroniza para poder registrar un gasto.
          </Text>
        </Tarjeta>
      ) : (
        <>
          <Text style={estilos.etiqueta}>Campo</Text>
          {campos.map((c) => (
            <Opcion key={c.id} etiqueta={c.nombre} seleccionada={c.id === campoId} onPress={() => setCampoId(c.id)} />
          ))}

          <Campo
            etiqueta="Monto en pesos"
            value={monto}
            onChangeText={setMonto}
            placeholder="0.00"
            keyboardType="decimal-pad"
            invalido={monto.trim() !== '' && validacion.montoCentavos === null}
          />

          <Campo
            etiqueta="Observaciones (opcional)"
            value={comentario}
            onChangeText={setComentario}
            placeholder="Lo que haya que recordar"
            maxLength={LARGO_MAX_COMENTARIO_GASTO}
            multiline
          />

          <Tarjeta etiqueta="Método">
            <Text style={estilos.textoTarjeta}>{TEXTO_METODO_GASTO}</Text>
          </Tarjeta>

          <Tarjeta estado={foto ? 'listo' : 'neutro'} etiqueta="Foto del ticket (opcional)">
            {foto ? <Pastilla texto="foto tomada" estado="listo" /> : null}
            <Boton
              etiqueta={foto ? 'Volver a tomar' : 'Tomar foto del ticket'}
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
        </>
      )}

      {faltantes.length > 0 && campos.length > 0 ? (
        <Text style={estilos.textoSuave}>{faltantes.join(' ')}</Text>
      ) : null}
      {/* Con el dia cerrado (se llega por una ruta profunda: la entrada del menu y
          el boton de la lista ya estan deshabilitados) dice por que no guarda. */}
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta="Guardar"
        glifo="✓"
        deshabilitado={
          !puedeGuardarGasto({
            gastoValido: validacion.gasto !== null,
            hayCampos: campos.length > 0,
            diaAbierto: menu.operacionesHabilitadas,
            guardado,
            tomandoFoto,
          })
        }
        onPress={guardar}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
