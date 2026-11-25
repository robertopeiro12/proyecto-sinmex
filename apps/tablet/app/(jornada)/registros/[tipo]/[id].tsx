import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import type { BaseDatos } from '@/datos/base-datos';
import type { DetalleVenta } from '@/datos/repositorios/ventas';
import type { Cobranza } from '@/datos/tipos';
import {
  datosDeLaVenta,
  datosDelCobro,
  datosDePago,
  encabezadoVenta,
  notasDelCobro,
  quedoAFavor,
  renglonesDeVenta,
  type DatoDetalle,
} from '@/estado/detalle-registro';
import { motivoDeRechazo } from '@/estado/ruta-del-dia';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { avisoNoImpreso, ticketDeVentaParaReimprimir, ticketsDelCobro } from '@/impresion/datos-ticket';
import type { DatosTicket } from '@/impresion/ticket';
import { useImpresion } from '@/impresion/usar-impresion';
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
 * cada nota que toco). Solo lectura: lo grabado no se edita. "Reimprimir"
 * (pieza 7) saca otra vez la nota de la venta o cada nota que toco el cobro.
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
        {pago ? <Dato dato={pago} /> : null}
        {credito ? <Dato dato={credito} color={colores.primario} /> : null}
      </Tarjeta>
      <Tarjeta>
        {datosDeLaVenta(v, vendedor?.nombre ?? 'Vendedor').map((d) => (
          <Dato key={d.etiqueta} dato={d} color={d.etiqueta === 'Sincronizada' ? colorSincronizada(d) : undefined} />
        ))}
        {v.sync_estado === 'error' && v.sync_error ? <Text style={estilos.error}>{motivoDeRechazo(v.sync_error)}</Text> : null}
      </Tarjeta>
      <Reimprimir armar={(bd) => [ticketDeVentaParaReimprimir(bd, v.id)]} />
    </Pantalla>
  );
}

function DetalleCobroVista({ cobro: c, cliente }: { cobro: Cobranza; cliente: string }) {
  const { datos } = useJawa();
  const { estilos } = useTema();
  const notas = notasDelCobro(c, (id) => datos.catalogos.folioDeNota(id));
  const aFavor = quedoAFavor(c);
  return (
    <Pantalla>
      <Stack.Screen options={{ title: 'Cobro' }} />
      <Tarjeta etiqueta={`Cobro · ${formatearHora(c.grabada_en)}`}>
        <Nombre texto={cliente} />
        <View style={{ marginTop: espacio.sm }}>
          {datosDelCobro(c).map((d) => (
            <Dato key={d.etiqueta} dato={d} color={d.etiqueta === 'Sincronizada' ? colorSincronizada(d) : undefined} />
          ))}
          {aFavor ? <Dato dato={aFavor} color={colores.primario} /> : null}
        </View>
        {c.sync_estado === 'error' && c.sync_error ? <Text style={estilos.error}>{motivoDeRechazo(c.sync_error)}</Text> : null}
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
      <Reimprimir armar={(bd, ahora) => ticketsDelCobro(bd, c, ahora)} />
    </Pantalla>
  );
}

/**
 * "Reimprimir" (rediseño pieza 7). La venta sale como su nota actual (con los
 * abonos de despues, si ya bajo); el cobro reimprime cada nota que toco, con
 * "Reimpresión <ahora>" y "Cobró <quien cobro>". Si no sale, solo se avisa.
 */
function Reimprimir({
  armar,
}: {
  armar: (bd: BaseDatos, ahora: string) => (DatosTicket | null)[];
}) {
  const { datos } = useJawa();
  const { estilos } = useTema();
  const { imprimirTickets } = useImpresion();
  const [imprimiendo, setImprimiendo] = useState(false);
  /** `null`: no hay aviso; si no, el aviso con el motivo (pieza 7b). */
  const [noImpresa, setNoImpresa] = useState<string | null>(null);

  const reimprimir = async () => {
    setImprimiendo(true);
    setNoImpresa(null);
    try {
      let tickets: (DatosTicket | null)[] = [null];
      try {
        tickets = armar(datos.deps.bd, datos.deps.reloj.ahora());
      } catch {
        // Se avisa como cualquier impresion que no salio.
      }
      const r = await imprimirTickets(tickets);
      setNoImpresa(r.ok ? null : avisoNoImpreso(r.detalle, { yaEnReimpresion: true }));
    } finally {
      setImprimiendo(false);
    }
  };

  return (
    <View style={{ marginTop: espacio.lg, marginBottom: espacio.xl, gap: espacio.sm }}>
      {noImpresa !== null ? (
        <>
          <Text style={estilos.error}>{noImpresa}</Text>
          <Boton
            etiqueta="Seleccionar impresora"
            icono="impresora"
            tono="neutra"
            onPress={() => router.push('/(jornada)/impresora')}
          />
        </>
      ) : null}
      <Boton etiqueta="Reimprimir" icono="impresora" onPress={() => void reimprimir()} ocupado={imprimiendo} />
    </View>
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
