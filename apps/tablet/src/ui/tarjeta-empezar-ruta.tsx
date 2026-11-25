import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { ErrorJornada } from '@/datos';
import type { Vehiculo } from '@/datos/tipos';
import { TEXTO_CANDADO, vehiculoPorOmision, type CandadoClientes } from '@/estado/empezar-ruta';
import { useJawa } from '@/estado/proveedor-jawa';

import { Boton } from './boton';
import { Campo } from './campo';
import { Opcion } from './opcion';
import { Tarjeta } from './pantalla';
import { useTema } from './tema';
import { espacio } from './tokens';

/**
 * La tarjeta de arriba de la Ruta mientras los clientes tienen candado
 * (rediseño, pieza 1; maquetas 1 y 2). Sustituye a la pantalla `abrir-dia`.
 *
 * - `empezar`: vehiculo (viene elegido el que asigno el portal) + kilometraje
 *   inicial + "Empezar ruta".
 * - `sin-carga` / `carga-pendiente` / `rechazada`: el aviso de inventario con
 *   "Ir a inventario".
 *
 * Solo se pinta con candado: con `null` la Ruta no la monta.
 */
export function TarjetaEmpezarRuta({ candado }: { candado: Exclude<CandadoClientes, null> }) {
  if (candado.tipo === 'empezar') return <FormularioEmpezar />;

  const { titulo, texto } = TEXTO_CANDADO[candado.tipo];
  return <AvisoInventario titulo={titulo} texto={texto} cargaId={candado.tipo === 'carga-pendiente' ? candado.cargaId : null} />;
}

function AvisoInventario({ titulo, texto, cargaId }: { titulo: string; texto: string; cargaId: string | null }) {
  const { estilos } = useTema();
  return (
    <Tarjeta estado="pendiente">
      <Text style={estilos.textoTarjeta}>{titulo}</Text>
      <Text style={estilos.textoSuave}>{texto}</Text>
      <Boton
        etiqueta="Ir a inventario"
        icono="adelante"
        onPress={() =>
          cargaId
            ? router.push({ pathname: '/(jornada)/inventario/[cargaId]', params: { cargaId } })
            : router.push('/(jornada)/inventario')
        }
        estilo={{ marginTop: espacio.sm }}
      />
    </Tarjeta>
  );
}

function FormularioEmpezar() {
  const { datos, vendedor, sucursalId, refrescarJornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();

  // `versionCatalogos`: en una tablet recien instalada la tarjeta monta con el
  // catalogo vacio y el pull llega despues (el defecto que tuvo `abrir-dia`).
  // Se lee para que `exhaustive-deps` no la marque como sobrante.
  const vehiculos = useMemo<Vehiculo[]>(() => {
    void versionCatalogos;
    return sucursalId ? datos.catalogos.listarVehiculos(sucursalId) : [];
  }, [datos, sucursalId, versionCatalogos]);
  const asignadoId = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.vehiculoAsignadoHoy();
  }, [datos, versionCatalogos]);

  const [elegidoId, setElegidoId] = useState<string | null>(null);
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Derivado, no sembrado en el estado: si la lista llega despues o el portal da
  // de baja el elegido, la seleccion cae sola al asignado o al primero.
  const vehiculoId = vehiculoPorOmision(vehiculos, asignadoId, elegidoId);

  const kmNumero = Number(km.replace(',', '.'));
  const puedeEmpezar = vehiculoId !== null && km.trim() !== '' && Number.isFinite(kmNumero);

  function empezar() {
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
      // T-37: la ruta de hace mas de 7 dias ya no sirve en la tablet (las altas
      // sin subir se conservan). Una vez al dia, con la tablet quieta. Aparte,
      // porque una limpieza fallida nunca debe impedir que el dia quede abierto.
      try {
        datos.rutas.purgar();
      } catch (e) {
        console.warn('No se pudo purgar la ruta vieja', e);
      }
      refrescarJornada();
    } catch (e) {
      setError(e instanceof ErrorJornada ? e.message : 'No se pudo empezar la ruta.');
    }
  }

  return (
    <Tarjeta estado="accion">
      <Text style={estilos.etiqueta}>Vehículo</Text>
      {vehiculos.length === 0 ? (
        <Text style={estilos.textoSuave}>
          Sin vehículos en el catálogo local. Bajan del portal con la sincronización; si acabas de
          entrar, espera unos segundos. Si sigue vacío, avisa a la oficina.
        </Text>
      ) : (
        <View style={estilos.rejilla}>
          {vehiculos.map((v) => (
            <Opcion
              key={v.id}
              etiqueta={v.nombre}
              seleccionada={v.id === vehiculoId}
              onPress={() => setElegidoId(v.id)}
            />
          ))}
        </View>
      )}

      <View style={{ marginTop: espacio.md }}>
        <Campo
          etiqueta="Kilometraje inicial"
          cifra
          // `number-pad` (el default de `cifra`) no trae separador decimal, y el
          // odometro a veces lo tiene. `numeric` si.
          keyboardType="numeric"
          inputMode="decimal"
          value={km}
          // El error se borra al corregir.
          onChangeText={(texto) => {
            setKm(texto);
            setError(null);
          }}
          placeholder="Ej. 84210"
        />
      </View>

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta="Empezar ruta"
        onPress={empezar}
        deshabilitado={!puedeEmpezar}
        estilo={{ marginTop: espacio.md }}
      />
    </Tarjeta>
  );
}
