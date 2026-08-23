import { Redirect, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ErrorJornada } from '@/datos';
import type { Vehiculo } from '@/datos/tipos';
import { useJawa } from '@/estado/proveedor-jawa';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, grosor } from '@/ui/tokens';

/**
 * Abrir el dia: vehiculo + kilometraje inicial.
 *
 * > [!danger] Bloqueante
 * > Segun [[App Tablet]], el vendedor **no puede hacer ninguna operacion** hasta
 * > registrar el kilometraje del dia. Esta pantalla es la unica salida hacia el
 * > resto de la app mientras no exista jornada; el guardia que lo impone vive en
 * > `app/(jornada)/_layout.tsx`.
 *
 * Es de las pocas pantallas de T-04 con logica real, porque el bloqueo es
 * **estructural** (afecta la navegacion completa), no parte de un modulo.
 */
export default function AbrirDia() {
  const { datos, vendedor, sucursalId, jornada, refrescarJornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();

  // `versionCatalogos` es la dependencia que faltaba. Sin ella, en una tablet
  // recien instalada esta pantalla se quedaba con la lista vacia que leyo al
  // montarse —el `pull` iba en camino— y el vendedor no podia abrir el dia hasta
  // reiniciar la app. Ver `datos/repositorios/catalogos.ts`.
  const vehiculos = useMemo<Vehiculo[]>(() => {
    // Se lee de verdad, y no solo se lista abajo, porque `exhaustive-deps` no
    // puede saber que una dependencia que no se usa en el cuerpo SI importa:
    // su valor no se ocupa para nada, lo que importa es que al cambiar obliga a
    // volver a consultar SQLite. Sin esta linea el linter la marca como
    // sobrante y el siguiente que "limpie el aviso" reintroduce el bloqueo.
    void versionCatalogos;
    return sucursalId ? datos.catalogos.listarVehiculos(sucursalId) : [];
  }, [datos, sucursalId, versionCatalogos]);

  const [vehiculoElegido, setVehiculoElegido] = useState<string | null>(null);
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * El vehiculo seleccionado se **deriva**, no se siembra en el estado inicial.
   *
   * La otra mitad del mismo defecto: `useState(vehiculos[0]?.id)` se evalua una
   * sola vez, y cuando esta pantalla monta la lista suele estar vacia. Aunque el
   * pull bajara el vehiculo un segundo despues, la seleccion se quedaba en
   * `null` para siempre y el boton seguia apagado con la lista ya llena.
   *
   * Derivarlo tambien cubre el caso contrario: si el portal da de baja el
   * vehiculo que el vendedor habia elegido, la seleccion cae sola al primero
   * disponible en vez de apuntar a una fila que ya no se lista.
   */
  const vehiculoId =
    vehiculos.find((v) => v.id === vehiculoElegido)?.id ?? vehiculos[0]?.id ?? null;

  const kmNumero = Number(km.replace(',', '.'));
  const puedeAbrir = vehiculoId !== null && km.trim() !== '' && Number.isFinite(kmNumero);

  // Sin sesion no hay vendedor de quien abrir la jornada (T-06).
  if (!vendedor) return <Redirect href="/login" />;
  // Ya abrio el dia: no tiene nada que hacer aqui.
  if (jornada) return <Redirect href="/(jornada)" />;

  function abrir() {
    setError(null);
    if (!vendedor) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    if (!vehiculoId) {
      setError('Selecciona el vehículo con el que sales a ruta.');
      return;
    }
    try {
      datos.jornadas.abrir({ vendedorId: vendedor.id, vehiculoId, kmInicial: kmNumero });
      refrescarJornada();
      router.replace('/(jornada)');
    } catch (e) {
      setError(e instanceof ErrorJornada ? e.message : 'No se pudo abrir el día.');
    }
  }

  return (
    <Pantalla
      formulario
      titulo="Abrir el día"
      subtitulo="Selecciona tu vehículo y captura el kilometraje inicial. Sin esto no puedes operar."
    >
      <Text style={estilos.etiqueta}>Vehículo</Text>

      {vehiculos.length === 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Catálogo vacío">
          <Text style={estilos.textoTarjeta}>Sin vehículos en el catálogo local</Text>
          <Text style={estilos.textoSuave}>
            Los vehículos bajan del portal con la sincronización, que corre sola tras un login con
            WiFi. Si acabas de entrar, espera unos segundos; si sigue vacío, avisa a la oficina.
          </Text>
        </Tarjeta>
      ) : (
        <View style={estilos.rejilla}>
          {vehiculos.map((vehiculo) => {
            const seleccionado = vehiculo.id === vehiculoId;
            return (
              // No es un `<Boton>`: elegir vehiculo **no hace nada** todavia,
              // solo marca. La accion de la pantalla es una sola, la de abajo.
              //
              // Lo seleccionado se distingue por tres canales a la vez (borde
              // grueso, fondo y la palabra "Seleccionado"), no solo por color:
              // misma regla que los botones opuestos, ver `boton.tsx`.
              <Pressable
                key={vehiculo.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: seleccionado }}
                accessibilityLabel={vehiculo.nombre}
                onPress={() => setVehiculoElegido(vehiculo.id)}
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
                <Text style={estilos.textoTarjeta}>{vehiculo.nombre}</Text>
                {seleccionado ? <Text style={estilos.textoSuave}>Seleccionado</Text> : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={{ marginTop: espacio.lg }}>
        <Campo
          etiqueta="Kilometraje inicial"
          cifra
          // `number-pad` (el default de `cifra`) no trae separador decimal, y el
          // odometro de la camioneta a veces lo tiene. `numeric` si.
          keyboardType="numeric"
          inputMode="decimal"
          value={km}
          onChangeText={setKm}
          placeholder="Ej. 128450"
        />
      </View>

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta="Abrir el día"
        onPress={abrir}
        deshabilitado={!puedeAbrir}
        estilo={{ marginTop: espacio.lg }}
      />
    </Pantalla>
  );
}
