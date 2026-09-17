import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ErrorProspecto } from '@/datos';
import type { Prospecto, TipoNegocio } from '@/datos/tipos';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { obtenerUbicacion } from '@/ubicacion/obtener';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, grosor } from '@/ui/tokens';

/**
 * Alta de prospectos en ruta (T-40).
 *
 * El [[Vendedor]] **ya no da de alta clientes** (cambio v2.0: el control del
 * precio es del administrador), pero si prospectos. Los campos son los que
 * dicto el cliente en agosto de 2026: nombre del negocio, encargado, telefono,
 * ubicacion, tipo de negocio y comentario.
 *
 * > [!info] La foto esta diferida, no olvidada
 * > El cliente la quiere (2026-08-23) *"si esto no se hace lento"*. Falta decidir
 * > donde se guarda el archivo — el candidato es Supabase Storage, y el alcance
 * > de Supabase es justo lo que `ADR-0002` dejo abierto. La columna `foto_uri`
 * > ya existe en la base local y el contrato ya manda `foto: null`, asi que ese
 * > ticket sera una pantalla y un upload, no una migracion.
 *
 * > [!warning] La ubicacion NO bloquea el alta
 * > Si el vendedor niega el permiso o no hay senal, el prospecto se guarda sin
 * > coordenadas y la pantalla lo dice. Bloquearlo seria peor: el vendedor esta
 * > parado enfrente del negocio, y la alternativa real no es "vuelve con
 * > permiso", es que no lo registre.
 *
 * Sistema de diseno: una sola accion primaria (*Guardar prospecto*); el boton de
 * ubicacion es `neutra` porque solo prepara un dato. El estado de la ubicacion y
 * el de la sincronizacion se codifican con **color + palabra**, nunca con color
 * solo (regla 2 del sistema de diseno).
 */
export default function Prospectos() {
  const { datos, vendedor, sucursalId, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();

  // `versionCatalogos` es la dependencia sin la que esta lista se queda con lo
  // que leyo al montarse: `datos` no cambia cuando el `pull` escribe en SQLite.
  // Es el mismo defecto que bloqueaba "Abrir el dia" el 2026-08-23. El `void`
  // es deliberado — sin el, `exhaustive-deps` la marca como sobrante y el
  // siguiente que "limpie el aviso" reintroduce el fallo.
  const tiposNegocio = useMemo<TipoNegocio[]>(() => {
    void versionCatalogos;
    return datos.catalogos.listarTiposNegocio();
  }, [datos, versionCatalogos]);

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [encargado, setEncargado] = useState('');
  const [comentarios, setComentarios] = useState('');
  const [tipoElegido, setTipoElegido] = useState<string | null>(null);
  const [ubicacion, setUbicacion] = useState<{ lat: number; lng: number } | null>(null);
  const [avisoUbicacion, setAvisoUbicacion] = useState<string | null>(null);
  const [buscandoUbicacion, setBuscandoUbicacion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [refrescos, setRefrescos] = useState(0);

  /**
   * El tipo seleccionado se **deriva** en vez de vivir solo en el estado: si el
   * portal da de baja el giro que el vendedor habia elegido, la seleccion cae
   * sola en vez de apuntar a una fila que ya no se lista (misma razon que el
   * vehiculo en `abrir-dia.tsx`). Aqui **no** cae al primero: el tipo de negocio
   * es opcional y elegirlo por el seria inventarse el giro del negocio.
   */
  const tipoNegocioId = tiposNegocio.find((t) => t.id === tipoElegido)?.id ?? null;

  // `ultimaSincronizacion` cubre el push que cambia el `sync_estado` de un
  // prospecto ya listado: sin ella, la pastilla se queda en "por subir" hasta
  // que algo mas vuelva a montar la pantalla, aunque el push haya terminado
  // con ella montada (M-3, PR #90; mismo patron que
  // `operacion/[clienteId]/index.tsx`).
  const prospectosDeHoy = useMemo<Prospecto[]>(() => {
    void refrescos;
    void versionCatalogos;
    void ultimaSincronizacion;
    return vendedor ? datos.prospectos.delDia(vendedor.id) : [];
  }, [datos, vendedor, refrescos, versionCatalogos, ultimaSincronizacion]);

  const puedeGuardar =
    vendedor !== null &&
    sucursalId !== null &&
    nombre.trim() !== '' &&
    telefono.trim() !== '';

  async function ubicar() {
    setAvisoUbicacion(null);
    setBuscandoUbicacion(true);
    try {
      const r = await obtenerUbicacion();
      if (r.estado === 'ok') {
        setUbicacion({ lat: r.lat, lng: r.lng });
        return;
      }
      setUbicacion(null);
      setAvisoUbicacion(
        r.estado === 'permiso-negado'
          ? 'Sin permiso de ubicación. Puedes guardar el prospecto igual; la oficina la capturará después.'
          : 'No se pudo leer la ubicación (sin señal de GPS). Puedes guardar el prospecto igual e intentarlo afuera del local.',
      );
    } finally {
      setBuscandoUbicacion(false);
    }
  }

  function guardar() {
    setError(null);
    setGuardado(null);
    if (!vendedor || !sucursalId) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    try {
      const p = datos.prospectos.registrar({
        vendedorId: vendedor.id,
        sucursalId,
        nombre,
        telefono,
        encargado: encargado.trim() === '' ? null : encargado,
        tipoNegocioId,
        comentarios: comentarios.trim() === '' ? null : comentarios,
        lat: ubicacion?.lat ?? null,
        lng: ubicacion?.lng ?? null,
      });

      // Se limpia el formulario, no se navega: lo normal es registrar varios
      // prospectos seguidos en la misma calle.
      setNombre('');
      setTelefono('');
      setEncargado('');
      setComentarios('');
      setTipoElegido(null);
      setUbicacion(null);
      setAvisoUbicacion(null);
      setGuardado(
        p.lat === null
          ? `Guardado "${p.nombre}" sin ubicación. Queda pendiente de subir.`
          : `Guardado "${p.nombre}" con ubicación. Queda pendiente de subir.`,
      );
      setRefrescos((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof ErrorProspecto ? e.message : 'No se pudo guardar el prospecto.',
      );
    }
  }

  return (
    <Pantalla
      titulo="Prospectos"
      subtitulo="Registra un negocio nuevo. El alta de clientes la hace la oficina; aquí solo prospectos."
    >
      <Campo
        etiqueta="Nombre del negocio"
        value={nombre}
        onChangeText={setNombre}
        placeholder="Ej. Tacos Aarón"
        autoCapitalize="words"
      />

      <Campo
        etiqueta="Teléfono"
        value={telefono}
        onChangeText={setTelefono}
        placeholder="Ej. 664 111 2233"
        keyboardType="phone-pad"
      />

      <Campo
        etiqueta="Encargado"
        value={encargado}
        onChangeText={setEncargado}
        placeholder="Quién atiende (opcional)"
        autoCapitalize="words"
      />

      <Text style={estilos.etiqueta}>Tipo de negocio</Text>

      {tiposNegocio.length === 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Catálogo vacío">
          <Text style={estilos.textoTarjeta}>Sin tipos de negocio</Text>
          <Text style={estilos.textoSuave}>
            Los tipos de negocio bajan del portal con la sincronización. Puedes registrar el
            prospecto sin él y la oficina lo clasificará.
          </Text>
        </Tarjeta>
      ) : (
        <View style={estilos.rejilla}>
          {tiposNegocio.map((tipo) => {
            const seleccionado = tipo.id === tipoNegocioId;
            return (
              // No es un `<Boton>`: elegir el giro **no hace nada** todavia, solo
              // marca. La accion de la pantalla es una sola, la de abajo.
              //
              // Lo seleccionado se distingue por tres canales (borde grueso,
              // fondo y la palabra "Seleccionado"), no solo por color: al sol los
              // fondos tenues se lavan y quedan todos del mismo blanco.
              <Pressable
                key={tipo.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: seleccionado }}
                accessibilityLabel={tipo.nombre}
                // Volver a tocar el elegido lo deselecciona: el tipo de negocio
                // es opcional y no puede haber forma de quedarse atrapado con uno
                // puesto por error.
                onPress={() => setTipoElegido(seleccionado ? null : tipo.id)}
                style={({ pressed }) => [
                  estilos.tarjeta,
                  estilos.celdaRejilla,
                  {
                    borderWidth: grosor.fuerte,
                    borderColor: seleccionado ? colores.primario : colores.borde,
                  },
                  seleccionado && { backgroundColor: colores.primarioTenue },
                  pressed && { transform: [{ translateY: grosor.fuerte }], opacity: 0.9 },
                ]}
              >
                <Text style={estilos.textoTarjeta}>{tipo.nombre}</Text>
                {seleccionado ? (
                  <Text style={estilos.textoSuave}>Seleccionado</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <Campo
        etiqueta="Comentario"
        value={comentarios}
        onChangeText={setComentarios}
        placeholder="Lo que haya que recordar (opcional)"
        multiline
      />

      <Tarjeta estado={ubicacion ? 'listo' : 'neutro'} etiqueta="Ubicación del negocio">
        {ubicacion ? (
          <>
            <Pastilla texto="ubicación capturada" estado="listo" />
            {/* Toda cifra que el vendedor lea va en monoespaciada (regla 3). */}
            <Cifra valor={`${ubicacion.lat.toFixed(6)}, ${ubicacion.lng.toFixed(6)}`} />
          </>
        ) : (
          <Text style={estilos.textoSuave}>
            Sin ubicación. No es obligatoria: si no la tomas, la oficina la capturará después.
          </Text>
        )}

        <Boton
          etiqueta={ubicacion ? 'Volver a ubicar' : 'Usar mi ubicación'}
          tono="neutra"
          glifo="⌖"
          onPress={ubicar}
          ocupado={buscandoUbicacion}
          estilo={{ marginTop: espacio.sm }}
        />

        {avisoUbicacion ? <Text style={estilos.textoSuave}>{avisoUbicacion}</Text> : null}
      </Tarjeta>

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      {guardado ? (
        <Tarjeta estado="pendiente" etiqueta="Listo">
          <Text style={estilos.textoTarjeta}>{guardado}</Text>
          <Text style={estilos.textoSuave}>
            Sube solo con la sincronización, al volver al WiFi del negocio.
          </Text>
        </Tarjeta>
      ) : null}

      <Boton
        etiqueta="Guardar prospecto"
        onPress={guardar}
        deshabilitado={!puedeGuardar}
        estilo={{ marginTop: espacio.md }}
      />

      <Text style={estilos.seccion}>Prospectos de hoy</Text>

      {prospectosDeHoy.length === 0 ? (
        <Tarjeta etiqueta="Sin registros">
          <Text style={estilos.textoSuave}>
            Todavía no has registrado prospectos hoy.
          </Text>
        </Tarjeta>
      ) : (
        prospectosDeHoy.map((p) => (
          <FilaProspecto key={p.id} prospecto={p} />
        ))
      )}
    </Pantalla>
  );
}

/** Estado de sincronizacion de una fila, en color + palabra (nunca color solo). */
const ESTADO_SYNC = {
  pendiente: { estado: 'pendiente' as const, texto: 'por subir' },
  enviando: { estado: 'pendiente' as const, texto: 'subiendo' },
  sincronizado: { estado: 'listo' as const, texto: 'subido' },
  error: { estado: 'error' as const, texto: 'rechazado' },
};

function FilaProspecto({ prospecto }: { prospecto: Prospecto }) {
  const { datos } = useJawa();
  const { estilos } = useTema();
  const pastilla = ESTADO_SYNC[prospecto.sync_estado];
  const tipo =
    prospecto.tipo_negocio_id === null
      ? null
      : // `obtenerTipoNegocio` y no `listarTiposNegocio`: hay que poder nombrar un
        // giro que el portal dio de baja despues de capturarse.
        datos.catalogos.obtenerTipoNegocio(prospecto.tipo_negocio_id);

  return (
    <Tarjeta estado={pastilla.estado} etiqueta={tipo?.nombre ?? 'Sin tipo de negocio'}>
      <Text style={estilos.textoTarjeta}>{prospecto.nombre}</Text>
      <Cifra valor={prospecto.telefono} tamano="menor" />
      <View style={{ flexDirection: 'row', gap: espacio.xs, marginTop: espacio.xs }}>
        <Pastilla texto={pastilla.texto} estado={pastilla.estado} />
        {prospecto.lat === null ? (
          <Pastilla texto="sin ubicación" estado="neutro" />
        ) : null}
      </View>
      {prospecto.sync_error ? (
        <Text style={estilos.textoSuave}>{prospecto.sync_error}</Text>
      ) : null}
    </Tarjeta>
  );
}
