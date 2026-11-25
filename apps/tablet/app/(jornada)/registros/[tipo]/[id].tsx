import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { DetalleVenta } from '@/datos/repositorios/ventas';
import type { Cobranza } from '@/datos/tipos';
import {
  datosDeLaVenta,
  datosDelCobro,
  datosDePago,
  encabezadoVenta,
  notasDelCobro,
  renglonesDeVenta,
  type DatoDetalle,
} from '@/estado/detalle-registro';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Cifra, pesos } from '@/ui/cifra';
import { formatearHora } from '@/ui/momento';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, tipo } from '@/ui/tokens';

/**
 * Abrir un movimiento del registro (rediseño pieza 5, maqueta 18): la venta
 * (folio, cliente, hora, renglones, promociones, Total, Pagó, Quedó a crédito,
 * Atendió, Vendedor, Sincronizada) o el cobro (cliente, hora, monto, método y
 * cada nota que toco). Solo lectura: lo grabado no se edita. Reimprimir llega
 * con la pieza 7.
 */
export default function DetalleRegistro() {
  const { tipo: tipoMov, id } = useLocalSearchParams<{ tipo: string; id: string }>();
  const { datos, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();

  // La subida cambia "Sincronizada"; el pull, el folio de las notas.
  const leido = useMemo(() => {
    void versionCatalogos;
    void ultimaSincronizacion;
    if (tipoMov === 'venta') {
      const detalle = datos.ventas.detalle(id);
      return detalle ? ({ tipo: 'venta', detalle } as const) : null;
    }
    if (tipoMov === 'cobro') {
      const cobro = datos.cobranzas.porId(id);
      return cobro ? ({ tipo: 'cobro', cobro } as const) : null;
    }
    return null;
  }, [datos, tipoMov, id, versionCatalogos, ultimaSincronizacion]);

  if (!leido) {
    return (
      <Pantalla titulo="Movimiento no encontrado" subtitulo="No está en esta tablet.">
        <Boton etiqueta="Volver" icono="atras" tono="neutra" onPress={() => router.back()} />
      </Pantalla>
    );
  }

  const cliente = (clienteId: string) => datos.catalogos.obtenerCliente(clienteId)?.nombre ?? 'Cliente';
  return leido.tipo === 'venta' ? (
    <DetalleVentaVista detalle={leido.detalle} cliente={cliente(leido.detalle.venta.cliente_id)} />
  ) : (
    <DetalleCobroVista cobro={leido.cobro} cliente={cliente(leido.cobro.cliente_id)} />
  );
}

function DetalleVentaVista({ detalle, cliente }: { detalle: DetalleVenta; cliente: string }) {
  const { vendedor } = useJawa();
  const { estilos } = useTema();
  const v = detalle.venta;
  const [pago, credito] = datosDePago(v);
  return (
    <Pantalla>
      <Stack.Screen options={{ title: 'Venta' }} />
      <Tarjeta etiqueta={encabezadoVenta(v)}>
        <Nombre texto={cliente} />
        <View style={{ marginTop: espacio.sm }}>
          {renglonesDeVenta(detalle).map((r, i) => (
            <View key={`${i}-${r.texto}`} style={{ marginBottom: espacio.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm }}>
                <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{r.texto}</Text>
                <Cifra valor={pesos(r.importeCentavos)} />
              </View>
              {r.frase ? <Text style={estilos.textoSuave}>{r.frase}</Text> : null}
            </View>
          ))}
        </View>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingTop: espacio.sm,
            marginTop: espacio.xs,
            borderTopWidth: grosor.hairline,
            borderTopColor: colores.borde,
          }}
        >
          <Text style={estilos.textoTarjeta}>Total</Text>
          <Cifra valor={pesos(v.monto_total_centavos)} tamano="destacado" />
        </View>
        <Dato dato={pago!} />
        <Dato dato={credito!} color={colores.primario} />
      </Tarjeta>
      <Tarjeta>
        {datosDeLaVenta(v, vendedor?.nombre ?? 'Vendedor').map((d) => (
          <Dato key={d.etiqueta} dato={d} color={d.etiqueta === 'Sincronizada' ? colorSincronizada(d) : undefined} />
        ))}
        {v.sync_estado === 'error' && v.sync_error ? <Text style={estilos.error}>{v.sync_error}</Text> : null}
      </Tarjeta>
    </Pantalla>
  );
}

function DetalleCobroVista({ cobro: c, cliente }: { cobro: Cobranza; cliente: string }) {
  const { datos } = useJawa();
  const { estilos } = useTema();
  const notas = notasDelCobro(c, (id) => datos.catalogos.folioDeNota(id));
  return (
    <Pantalla>
      <Stack.Screen options={{ title: 'Cobro' }} />
      <Tarjeta etiqueta={`Cobro · ${formatearHora(c.grabada_en)}`}>
        <Nombre texto={cliente} />
        <View style={{ marginTop: espacio.sm }}>
          {datosDelCobro(c).map((d) => (
            <Dato key={d.etiqueta} dato={d} color={d.etiqueta === 'Sincronizada' ? colorSincronizada(d) : undefined} />
          ))}
        </View>
        {c.sync_estado === 'error' && c.sync_error ? <Text style={estilos.error}>{c.sync_error}</Text> : null}
      </Tarjeta>
      <Tarjeta etiqueta={notas.length === 1 ? 'Nota' : 'Notas'}>
        {notas.map((n, i) => (
          <View
            key={`${i}-${n.folio}`}
            style={{
              gap: espacio.xs,
              paddingVertical: espacio.sm,
              borderTopWidth: i === 0 ? 0 : grosor.hairline,
              borderTopColor: colores.borde,
            }}
          >
            <Text style={estilos.textoTarjeta}>{n.folio}</Text>
            <Text style={estilos.textoSuave}>{n.aplicado}</Text>
            {n.saldoDespues ? <Text style={estilos.textoSuave}>{n.saldoDespues}</Text> : null}
          </View>
        ))}
      </Tarjeta>
    </Pantalla>
  );
}

function colorSincronizada(d: DatoDetalle): string {
  return d.valor === 'Sí' ? colores.exito : colores.aviso;
}

function Nombre({ texto }: { texto: string }) {
  const { t } = useTema();
  return (
    <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}>{texto}</Text>
  );
}

/** "Etiqueta ........ valor", como los `kv` de la maqueta 18. */
function Dato({ dato, color }: { dato: DatoDetalle; color?: string }) {
  const { estilos, t } = useTema();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm, marginTop: espacio.xs }}>
      <Text style={estilos.textoSuave}>{dato.etiqueta}</Text>
      <Text
        style={{
          flexShrink: 1,
          textAlign: 'right',
          fontFamily: fuente.cuerpoFuerte,
          fontSize: t(tipo.cuerpo),
          color: color ?? colores.tinta,
        }}
      >
        {dato.valor}
      </Text>
    </View>
  );
}
