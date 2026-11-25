import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import {
  filasPorRegresar,
  NOTA_CONTROL_APAGADO,
  pastillaCarga,
  cambiosNetos,
  etiquetaSinCortarVolumen,
  palabraPiezas,
  salio,
  textoCambios,
  piezasDeCarga,
  tituloAvisoCarga,
  totalPiezas,
} from '@/estado/inventario';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Cifra } from '@/ui/cifra';
import { MarcoMenu } from '@/ui/marco-menu';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Inventario (T-27, entrada del menu; rediseño pieza 3, maqueta 5): arriba, el
 * aviso de cada carga o recarga por aceptar ("Revisar recarga" abre el mismo
 * checklist); el resumen por producto: Cargado · Salió · Cambios · Te quedan (solo los
 * renglones aceptados; Salió = vendido, regalado, mermas y consumo); lo que hay
 * que regresar a la planta, y las cargas de hoy ya respondidas con su estado
 * ("Aceptada 3 de 5"). Con el control apagado se muestra igual, con la nota.
 * Toda la cuenta vive en `inventario-reglas.ts` (con pruebas); aqui solo se pinta.
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
  const pendientes = vista.cargas.filter((c) => c.estado === 'pendiente');
  const respondidas = vista.cargas.filter((c) => c.estado !== 'pendiente');
  const abrir = (cargaId: string) =>
    router.push({ pathname: '/(jornada)/inventario/[cargaId]', params: { cargaId } });

  return (
    <MarcoMenu clave="inventario" titulo="Inventario">
      <Pantalla subtitulo="Lo que traes hoy: lo que aceptaste menos lo que vendiste, regalaste, repusiste, se mermó y consumiste.">
        {!vista.control ? (
          <Tarjeta estado="pendiente" etiqueta="Control apagado">
            <Text style={estilos.textoTarjeta}>{NOTA_CONTROL_APAGADO}.</Text>
            <Text style={estilos.textoSuave}>Puedes vender como siempre; el inventario se muestra igual.</Text>
          </Tarjeta>
        ) : null}

        {pendientes.map((c) => (
          <Tarjeta key={c.id} estado="pendiente" etiqueta={tituloAvisoCarga(c)}>
            <Text style={estilos.textoTarjeta}>
              Carga n.º {c.numero} · {c.lineas.length === 1 ? '1 producto' : `${c.lineas.length} productos`} ·{' '}
              <Cifra valor={totalPiezas(c.lineas)} /> {palabraPiezas(totalPiezas(c.lineas))}
            </Text>
            <Boton
              etiqueta={c.numero > 1 ? 'Revisar recarga' : 'Revisar carga'}
              tono="primaria"
              icono="adelante"
              ancho="ajustado"
              onPress={() => abrir(c.id)}
              estilo={{ marginTop: espacio.sm }}
            />
          </Tarjeta>
        ))}

        <Text style={estilos.seccion}>Lo que traes</Text>
        {vista.filas.length === 0 ? (
          <Tarjeta etiqueta="Sin producto">
            <Text style={estilos.textoSuave}>
              {vista.cargas.length === 0
                ? 'El almacén todavía no te registra carga hoy. Cuando te la entreguen, toca Refrescar en la ruta.'
                : 'Acepta una carga para ver lo que traes.'}
            </Text>
          </Tarjeta>
        ) : (
          <Tarjeta etiqueta="Por producto">
            <View style={[filaResumen, { marginBottom: espacio.sm }]}>
              <Text style={[estilos.etiqueta, columnaProducto]}>Producto</Text>
              {/* Una sola palabra: en un renglón y, si no cabe, más chica; nunca partida (D3). */}
              <Text style={[estilos.etiqueta, columnaTitulo]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                Cargado
              </Text>
              <Text style={[estilos.etiqueta, columnaTitulo]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                Salió
              </Text>
              <Text style={[estilos.etiqueta, columnaTitulo]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                Cambios
              </Text>
              <Text style={[estilos.etiqueta, columnaTitulo]}>Te quedan</Text>
            </View>
            {vista.filas.map((f) => (
              <View key={f.presentacionId} style={[filaResumen, { marginBottom: espacio.xs }]}>
                <Text style={[estilos.textoTarjeta, columnaProducto]}>{etiquetaSinCortarVolumen(f.etiqueta)}</Text>
                <View style={columnaCifra}>
                  <Cifra valor={f.cargado} tono="suave" />
                </View>
                <View style={columnaCifra}>
                  <Cifra valor={salio(f)} tono="suave" />
                </View>
                <View style={columnaCifra}>
                  <Cifra valor={textoCambios(cambiosNetos(f))} tono="suave" />
                </View>
                <View style={columnaCifra}>
                  <Cifra valor={f.existencia} tono={f.existencia <= 0 ? 'peligro' : 'tinta'} />
                </View>
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

        {respondidas.length > 0 ? (
          <>
            <Text style={estilos.seccion}>Cargas de hoy</Text>
            {respondidas.map((c) => {
              const p = pastillaCarga(c);
              return (
                <Tarjeta key={c.id} estado={p.estado} etiqueta={`Carga n.º ${c.numero}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.sm }}>
                    <Pastilla texto={p.texto} estado={p.estado} />
                    <Text style={estilos.textoSuave}>
                      <Cifra valor={piezasDeCarga(c)} tono="suave" /> {palabraPiezas(piezasDeCarga(c))}
                    </Text>
                  </View>
                  {c.estado === 'rechazada' && c.motivo_rechazo ? (
                    <Text style={estilos.error}>La rechazaste: {c.motivo_rechazo}</Text>
                  ) : null}
                  <Boton
                    etiqueta="Ver la carga"
                    tono="neutra"
                    icono="adelante"
                    ancho="ajustado"
                    onPress={() => abrir(c.id)}
                    estilo={{ marginTop: espacio.sm }}
                  />
                </Tarjeta>
              );
            })}
          </>
        ) : null}
      </Pantalla>
    </MarcoMenu>
  );
}

// Recorrido final, D3: a 1080 px los encabezados se partian a media palabra
// ("CARGA/DO", "CAMBI/OS"). Menos hueco, el producto mas angosto, sin
// interletrado en los encabezados de numeros y los de una palabra en un solo
// renglon (se achican si no caben); "Te quedan" se parte por palabras.
const filaResumen = { flexDirection: 'row', alignItems: 'center', gap: espacio.xs } as const;
const columnaProducto = { flex: 1.3 } as const;
const columnaTitulo = { flex: 1, textAlign: 'right', letterSpacing: 0 } as const;
const columnaCifra = { flex: 1, alignItems: 'flex-end' } as const;
