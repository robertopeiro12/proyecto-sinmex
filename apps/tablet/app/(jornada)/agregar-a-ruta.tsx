import { useMemo, useState } from "react";
import { Alert, Platform, Text, ToastAndroid, View } from "react-native";

import { ErrorJornada, ErrorRuta } from "@/datos";
import type { Cliente } from "@/datos/tipos";
import { estadoMenuJornada } from "@/estado/menu-jornada";
import { useJawa } from "@/estado/proveedor-jawa";
import {
  clientesParaAgregar,
  primeraLineaDomicilio,
  textoAgregado,
} from "@/estado/ruta-del-dia";
import { Boton } from "@/ui/boton";
import { Campo } from "@/ui/campo";
import { Pantalla, Pastilla, Tarjeta } from "@/ui/pantalla";
import { useTema } from "@/ui/tema";
import { colores, espacio, fuente, grosor, radio, tipo } from "@/ui/tokens";

/** El aviso breve al volver a la lista (D16). La app es Android; en otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === "android") ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * "Agregar a mi ruta" (T-37, D2, D7; maqueta 20): todos los clientes EXISTENTES
 * de la sucursal, en orden alfabetico. Los que ya estan en la ruta de hoy dicen
 * "En ruta" (no tocable); los demas llevan el boton "Agregar a mi ruta", que los
 * pone al final y deja la fila en "En ruta". El vendedor no da de alta clientes.
 */
export default function AgregarARuta() {
  const { datos, vendedor, sucursalId, jornada, versionCatalogos } = useJawa();
  const { estilos, t } = useTema();
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refrescos, setRefrescos] = useState(0);
  const menu = estadoMenuJornada(jornada);
  // Sin jornada de hoy tampoco se agrega (la capa de datos exige una abierta).
  const puedeAgregar = jornada !== null && menu.operacionesHabilitadas;

  const candidatos = useMemo<(Cliente & { enRuta: boolean })[]>(() => {
    void versionCatalogos;
    void refrescos;
    if (!sucursalId) return [];
    const enRuta = new Set(
      datos.rutas
        .delDia()
        .filter((f) => f.activo === 1)
        .map((f) => f.cliente_id),
    );
    return clientesParaAgregar(
      datos.catalogos.listarClientes(sucursalId),
      enRuta,
      busqueda,
    );
  }, [datos, sucursalId, busqueda, versionCatalogos, refrescos]);

  function agregar(cliente: Cliente) {
    setError(null);
    if (!vendedor || !sucursalId) {
      setError("No hay vendedor con sesión iniciada.");
      return;
    }
    try {
      datos.rutas.agregar(cliente.id, { vendedorId: vendedor.id, sucursalId });
      avisar(textoAgregado(cliente.nombre));
      setRefrescos((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof ErrorRuta || e instanceof ErrorJornada
          ? e.message
          : "No se pudo agregar el cliente a la ruta.",
      );
    }
  }

  return (
    <Pantalla
      titulo="Agregar a mi ruta"
      subtitulo="Clientes de tu sucursal. Los que agregues quedan al final de la ruta de hoy."
    >
      {menu.avisoDiaCerrado ? (
        <Tarjeta estado="listo" etiqueta="Día cerrado">
          <Text style={estilos.textoTarjeta}>{menu.avisoDiaCerrado}</Text>
        </Tarjeta>
      ) : null}

      <Campo
        etiqueta="Buscar por nombre"
        value={busqueda}
        onChangeText={setBusqueda}
        placeholder="Escribe parte del nombre"
        autoCorrect={false}
      />

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      {candidatos.length === 0 ? (
        <Text style={estilos.textoSuave}>
          {busqueda.trim() === ""
            ? "No hay clientes activos en tu sucursal."
            : "Ningún cliente coincide con esa búsqueda."}
        </Text>
      ) : (
        <View style={{ gap: espacio.sm }}>
          {candidatos.map((cliente) => (
            <View
              key={cliente.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: espacio.md,
                padding: espacio.md,
                borderRadius: radio.medio,
                borderWidth: grosor.fuerte,
                borderColor: colores.bordeFuerte,
                backgroundColor: colores.superficie,
              }}
            >
              <View style={{ flex: 1, gap: espacio.xs }}>
                <Text
                  style={{
                    fontFamily: fuente.cuerpoFuerte,
                    fontSize: t(tipo.destacado),
                    color: colores.tinta,
                  }}
                >
                  {cliente.nombre}
                </Text>
                <Text style={estilos.textoSuave}>
                  {primeraLineaDomicilio(cliente.domicilio)}
                </Text>
              </View>
              {cliente.enRuta ? (
                <Pastilla texto="En ruta" estado="listo" />
              ) : (
                <Boton
                  etiqueta="Agregar a mi ruta"
                  icono="agregar-cliente"
                  ancho="ajustado"
                  deshabilitado={!puedeAgregar}
                  onPress={() => agregar(cliente)}
                />
              )}
            </View>
          ))}
        </View>
      )}
    </Pantalla>
  );
}
