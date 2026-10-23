import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { filasPorRegresar, NOTA_CONTROL_APAGADO, pastillaCarga, totalPiezas } from '@/estado/inventario';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Cifra } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Inventario (T-27, entrada del menu): las cargas de hoy con su estado y total;
 * por presentacion Cargado − Vendido − Regalado − Merma entregada − Merma del
 * trayecto − Consumo = Existencia (pieza 2), y lo que hay que regresar a la
 * planta: piezas buenas y merma. Con el control apagado se muestra igual, con
 * la nota. Toda la cuenta vive en `inventario-reglas.ts` (con pruebas); aqui
 * solo se pinta.
 */
export default function Inventario() {
  const { datos, vendedor, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();

  // `versionCatalogos` sube cuando el pull o una respuesta escriben cargas, y
  // cuando una venta publica su cambio; al volver de vender ya esta al dia.
  const vista = useMemo(() => {
    void versionCatalogos;
    void ultimaSincronizacion;
    if (!vendedor) return { cargas: [], filas: [], control: false };
    return {
      cargas: datos.cargas.delDia(vendedor.id),
      filas: datos.cargas.filasInventario(vendedor.id),
      control: datos.cargas.controlInventario(vendedor.id),
    };
  }, [datos, vendedor, versionCatalogos, ultimaSincronizacion]);

  const porRegresar = filasPorRegresar(vista.filas);

  return (
    <Pantalla
      titulo="Inventario"
      subtitulo="Lo que traes hoy: tus cargas aceptadas menos lo que vendiste, regalaste, repusiste, se mermó y consumiste."
    >
      {!vista.control ? (
        <Tarjeta estado="pendiente" etiqueta="Control apagado">
          <Text style={estilos.textoTarjeta}>{NOTA_CONTROL_APAGADO}.</Text>
          <Text style={estilos.textoSuave}>Puedes vender como siempre; el inventario se muestra igual.</Text>
        </Tarjeta>
      ) : null}

      <Text style={estilos.seccion}>Cargas de hoy</Text>
      {vista.cargas.length === 0 ? (
        <Tarjeta etiqueta="Sin cargas">
          <Text style={estilos.textoSuave}>
            El almacén todavía no te registra carga hoy. Cuando te la entreguen, toca Refrescar en la ruta.
          </Text>
        </Tarjeta>
      ) : (
        vista.cargas.map((c) => {
          const p = pastillaCarga(c.estado);
          return (
            <Tarjeta key={c.id} estado={p.estado} etiqueta={`Carga n.º ${c.numero}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.sm }}>
                <Pastilla texto={p.texto} estado={p.estado} />
                <Text style={estilos.textoSuave}>
                  <Cifra valor={totalPiezas(c.lineas)} tono="suave" /> piezas
                </Text>
              </View>
              {c.estado === 'rechazada' && c.motivo_rechazo ? (
                <Text style={estilos.error}>La rechazaste: {c.motivo_rechazo}</Text>
              ) : null}
              <Boton
                etiqueta={c.estado === 'pendiente' ? 'Revisar y aceptar' : 'Ver la carga'}
                tono={c.estado === 'pendiente' ? 'primaria' : 'neutra'}
                glifo="→"
                ancho="ajustado"
                onPress={() =>
                  router.push({ pathname: '/(jornada)/inventario/[cargaId]', params: { cargaId: c.id } })
                }
                estilo={{ marginTop: espacio.sm }}
              />
            </Tarjeta>
          );
        })
      )}

      <Text style={estilos.seccion}>Por presentación</Text>
      {vista.filas.length === 0 ? (
        <Tarjeta etiqueta="Sin producto">
          <Text style={estilos.textoSuave}>Acepta una carga para ver lo que traes.</Text>
        </Tarjeta>
      ) : (
        <Tarjeta etiqueta="Cargado − Vendido − Regalado − Merma entregada − Merma del trayecto − Consumo = Existencia">
          {vista.filas.map((f) => (
            <View
              key={f.presentacionId}
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: espacio.sm,
                marginBottom: espacio.xs,
              }}
            >
              <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{f.etiqueta}</Text>
              <Text style={estilos.textoSuave}>
                <Cifra valor={f.cargado} tono="suave" /> − <Cifra valor={f.vendido} tono="suave" /> −{' '}
                <Cifra valor={f.regalado} tono="suave" /> − <Cifra valor={f.mermaEntregada} tono="suave" /> −{' '}
                <Cifra valor={f.mermaTrayecto} tono="suave" /> − <Cifra valor={f.consumo} tono="suave" /> ={' '}
                <Cifra valor={f.existencia} tono={f.existencia <= 0 ? 'peligro' : 'tinta'} />
              </Text>
            </View>
          ))}
        </Tarjeta>
      )}

      <Text style={estilos.seccion}>Por regresar a la planta</Text>
      {porRegresar.length === 0 ? (
        <Tarjeta etiqueta="Nada por regresar">
          <Text style={estilos.textoSuave}>Cuando te quede producto o registres merma, aparece aquí.</Text>
        </Tarjeta>
      ) : (
        <Tarjeta etiqueta="Piezas buenas · Merma">
          {porRegresar.map((f) => (
            <View
              key={f.presentacionId}
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm, marginBottom: espacio.xs }}
            >
              <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{f.etiqueta}</Text>
              <Text style={estilos.textoSuave}>
                Buenas <Cifra valor={f.buenas} tono="tinta" /> · Merma{' '}
                <Cifra valor={f.merma} tono={f.merma > 0 ? 'aviso' : 'suave'} />
              </Text>
            </View>
          ))}
        </Tarjeta>
      )}
    </Pantalla>
  );
}
