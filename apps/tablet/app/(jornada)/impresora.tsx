import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { relojSistema } from '@/datos/reloj';
import { useJawa } from '@/estado/proveedor-jawa';
import type { ResultadoImpresion } from '@/impresion/controlador';
import { codigoDeError, SIN_BLUETOOTH, textoErrorImpresora } from '@/impresion/errores-impresora';
import type { Papel } from '@/impresion/html';
import type { ImpresoraElegida } from '@/impresion/preferencia';
import { ticketDePrueba } from '@/impresion/prueba';
import { puenteBluetooth } from '@/impresion/puente-bluetooth';
import { useImpresion } from '@/impresion/usar-impresion';
import { Boton } from '@/ui/boton';
import { Palomita, Renglon } from '@/ui/checklist';
import { Chip } from '@/ui/chip';
import { Icono } from '@/ui/icono';
import { MarcoMenu } from '@/ui/marco-menu';
import { Pantalla, Tarjeta, type Estado } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio } from '@/ui/tokens';

import type { ImpresoraEmparejada } from '../../modules/impresora-bluetooth';

const PAPELES: { papel: Papel; etiqueta: string }[] = [
  { papel: 58, etiqueta: '58 mm' },
  { papel: 80, etiqueta: '80 mm' },
];

const DIALOGO = 'Diálogo de Android (otra impresora o PDF)';
const AYUDA = 'Empareja la impresora en Ajustes > Bluetooth (PIN 0000 o 1234) y vuelve aquí.';

/** Las impresoras emparejadas: se leen al entrar y con "Actualizar lista". */
type Lista =
  | { estado: 'cargando' }
  | { estado: 'lista'; impresoras: ImpresoraEmparejada[] }
  /** Sin modulo en el APK o sin adaptador: solo queda el dialogo. */
  | { estado: 'sin-bluetooth' }
  /** Bluetooth apagado, sin permiso u otro error al leer: se puede reintentar. */
  | { estado: 'error'; texto: string };

async function leerLista(): Promise<Lista> {
  if (!puenteBluetooth.disponible()) return { estado: 'sin-bluetooth' };
  try {
    return { estado: 'lista', impresoras: await puenteBluetooth.emparejadas() };
  } catch (e) {
    const code = codigoDeError(e);
    if (code === 'sin-bluetooth') return { estado: 'sin-bluetooth' };
    return {
      estado: 'error',
      texto: code ? textoErrorImpresora(code, 'la impresora') : 'No se pudo leer la lista de impresoras.',
    };
  }
}

/** Lo que se le dice al vendedor despues de "Imprimir prueba", segun la impresora con que se imprimio. */
function mensaje(
  r: ResultadoImpresion,
  impresora: ImpresoraElegida | null,
): { estado: Estado; etiqueta: string; texto: string } {
  const dialogo = impresora?.tipo === 'dialogo';
  if (r.ok) {
    if (impresora?.tipo === 'bluetooth') {
      return { estado: 'listo', etiqueta: 'Impresa', texto: `Se mandó la prueba a ${impresora.nombre}.` };
    }
    // En Android `ok` es "se abrio el dialogo" (ver `controlador.ts`), no "salio el papel".
    return {
      estado: 'listo',
      etiqueta: 'Enviada a Android',
      texto: 'Se abrió la impresión de Android. Si no salió el papel, revisa que la impresora esté encendida y elegida ahí.',
    };
  }
  if (r.motivo === 'cancelada') {
    return { estado: 'pendiente', etiqueta: 'Cancelada', texto: 'No se imprimió la prueba.' };
  }
  if (!dialogo) {
    // Bluetooth o sin elegir: `detalle` ya es el texto para el vendedor.
    return { estado: 'error', etiqueta: 'No se pudo imprimir', texto: r.detalle ?? 'No se pudo imprimir la prueba.' };
  }
  return {
    estado: 'error',
    etiqueta: 'No se pudo imprimir',
    texto: r.detalle ? `Android respondió: ${r.detalle}` : 'Android no pudo abrir la impresión.',
  };
}

/**
 * "Seleccionar impresora" (rediseno piezas 7 y 7b): la impresora con que salen
 * las notas (una termica emparejada por Bluetooth, que imprime directo, o el
 * dialogo de Android para otra impresora o PDF), el papel (58 u 80 mm) y una
 * nota de prueba. Lo elegido se guarda al tocarlo; imprimir lo relee.
 */
export default function Impresora() {
  const { vendedor } = useJawa();
  const { estilos } = useTema();
  const { papel, elegirPapel, impresora, elegirImpresora, imprimirTicket } = useImpresion();
  const [lista, setLista] = useState<Lista>({ estado: 'cargando' });
  const [imprimiendo, setImprimiendo] = useState(false);
  const [resultado, setResultado] = useState<{ r: ResultadoImpresion; con: ImpresoraElegida | null } | null>(null);
  const [errorPapel, setErrorPapel] = useState<string | null>(null);
  const [errorImpresora, setErrorImpresora] = useState<string | null>(null);

  // Al entrar (el estado ya nace en "cargando").
  useEffect(() => {
    let vivo = true;
    void leerLista().then((l) => {
      if (vivo) setLista(l);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const actualizar = async () => {
    setLista({ estado: 'cargando' });
    setLista(await leerLista());
  };

  // Si no se pudo guardar, se queda el papel de antes (el hook no lo cambia) y se avisa.
  const cambiarPapel = async (p: Papel) => {
    setResultado(null);
    setErrorPapel(null);
    try {
      await elegirPapel(p);
    } catch {
      setErrorPapel('No se pudo guardar el ancho del papel. Se queda el de antes; intenta de nuevo.');
    }
  };

  const cambiarImpresora = async (i: ImpresoraElegida) => {
    setResultado(null);
    setErrorImpresora(null);
    try {
      await elegirImpresora(i);
    } catch {
      setErrorImpresora('No se pudo guardar la impresora. Se queda la de antes; intenta de nuevo.');
    }
  };

  const imprimirPrueba = async () => {
    setImprimiendo(true);
    setResultado(null);
    // Sin elegir y sin el modulo Bluetooth se imprime con el dialogo (`controladorAUsar`).
    const con: ImpresoraElegida | null =
      impresora ?? (puenteBluetooth.disponible() ? null : { tipo: 'dialogo' });
    try {
      setResultado({ r: await imprimirTicket(ticketDePrueba(relojSistema, vendedor?.nombre)), con });
    } finally {
      setImprimiendo(false);
    }
  };

  const aviso = resultado ? mensaje(resultado.r, resultado.con) : null;
  const esDialogo = impresora?.tipo === 'dialogo';
  // Solo se sabe que "ya no esta emparejada" con la lista leida bien.
  const yaNoEmparejada =
    impresora?.tipo === 'bluetooth' &&
    lista.estado === 'lista' &&
    !lista.impresoras.some((i) => i.direccion === impresora.direccion);

  return (
    <MarcoMenu clave="impresora" titulo="Seleccionar impresora">
      <Pantalla subtitulo="Elige la impresora de las notas. La térmica por Bluetooth imprime directo; el diálogo de Android sirve para otra impresora o para guardar un PDF.">
        <Tarjeta>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.sm, marginBottom: espacio.md }}>
            <Icono nombre="bluetooth" tamano={24} color={colores.tinta} />
            <Text style={estilos.textoTarjeta}>Impresora</Text>
          </View>

          {impresora === null ? (
            <Text style={[estilos.textoSuave, { marginBottom: espacio.md }]}>
              {puenteBluetooth.disponible()
                ? 'Aún no eliges impresora. Las notas no se imprimen hasta que elijas una.'
                : 'Aún no eliges impresora. Mientras, las notas salen por el diálogo de Android.'}
            </Text>
          ) : null}

          {lista.estado === 'sin-bluetooth' ? (
            <Text style={[estilos.textoSuave, { marginBottom: espacio.md }]}>{SIN_BLUETOOTH}</Text>
          ) : (
            <>
              {lista.estado === 'cargando' ? (
                <Text style={[estilos.textoSuave, { marginBottom: espacio.md }]}>Buscando impresoras emparejadas…</Text>
              ) : null}
              {lista.estado === 'error' ? (
                <Text style={[estilos.error, { marginBottom: espacio.md }]}>{lista.texto}</Text>
              ) : null}
              {lista.estado === 'lista' && lista.impresoras.length === 0 ? (
                <Text style={[estilos.textoSuave, { marginBottom: espacio.md }]}>
                  No hay impresoras emparejadas.
                </Text>
              ) : null}
              {lista.estado === 'lista'
                ? lista.impresoras.map((i) => {
                    const elegida = impresora?.tipo === 'bluetooth' && impresora.direccion === i.direccion;
                    return (
                      <Renglon
                        key={i.direccion}
                        onPress={() =>
                          void cambiarImpresora({ tipo: 'bluetooth', nombre: i.nombre, direccion: i.direccion })
                        }
                        borde={elegida ? colores.exito : colores.borde}
                        etiqueta={`${i.nombre}, ${i.direccion}`}
                        estadoA11y={elegida}
                      >
                        <Palomita encendida={elegida} />
                        <View style={{ flex: 1 }}>
                          <Text style={estilos.textoTarjeta}>{i.nombre}</Text>
                          <Text style={estilos.textoSuave}>{i.direccion}</Text>
                        </View>
                      </Renglon>
                    );
                  })
                : null}
              {yaNoEmparejada ? (
                <Text style={[estilos.error, { marginBottom: espacio.md }]}>
                  La impresora {impresora.nombre} ya no está emparejada. Elige otra.
                </Text>
              ) : null}
            </>
          )}

          <Renglon
            onPress={() => void cambiarImpresora({ tipo: 'dialogo' })}
            borde={esDialogo ? colores.exito : colores.borde}
            etiqueta={DIALOGO}
            estadoA11y={esDialogo}
          >
            <Palomita encendida={esDialogo} />
            <Text style={[estilos.textoTarjeta, { flex: 1 }]}>{DIALOGO}</Text>
          </Renglon>

          {lista.estado !== 'sin-bluetooth' ? (
            <>
              <Text style={[estilos.textoSuave, { marginTop: espacio.sm }]}>{AYUDA}</Text>
              <Boton
                etiqueta="Actualizar lista"
                icono="sincronizar"
                tono="neutra"
                onPress={() => void actualizar()}
                ocupado={lista.estado === 'cargando'}
                estilo={{ marginTop: espacio.md }}
              />
            </>
          ) : null}
          {errorImpresora ? <Text style={[estilos.error, { marginTop: espacio.sm }]}>{errorImpresora}</Text> : null}
        </Tarjeta>

        <View style={{ marginTop: espacio.lg }}>
          <Tarjeta>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.sm }}>
              <Icono nombre="impresora" tamano={24} color={colores.tinta} />
              <Text style={estilos.textoTarjeta}>Ancho del papel</Text>
            </View>
            <View
              accessibilityRole="radiogroup"
              style={{ flexDirection: 'row', gap: espacio.sm, marginTop: espacio.md }}
            >
              {PAPELES.map((p) => (
                <Chip
                  key={p.papel}
                  etiqueta={p.etiqueta}
                  elegida={papel === p.papel}
                  ancho
                  onPress={() => void cambiarPapel(p.papel)}
                />
              ))}
            </View>
            <Text style={[estilos.textoSuave, { marginTop: espacio.sm }]}>
              58 mm es el rollo angosto (32 letras por renglón); 80 mm, el ancho (48).
            </Text>
            {errorPapel ? <Text style={[estilos.error, { marginTop: espacio.sm }]}>{errorPapel}</Text> : null}
          </Tarjeta>
        </View>

        <Boton
          etiqueta="Imprimir prueba"
          icono="impresora"
          onPress={() => void imprimirPrueba()}
          ocupado={imprimiendo}
          deshabilitado={papel === null || impresora === undefined}
          estilo={{ marginTop: espacio.lg }}
        />

        {aviso ? (
          <View style={{ marginTop: espacio.md }}>
            <Tarjeta estado={aviso.estado} etiqueta={aviso.etiqueta}>
              <Text style={estilos.textoTarjeta}>{aviso.texto}</Text>
            </Tarjeta>
          </View>
        ) : null}
      </Pantalla>
    </MarcoMenu>
  );
}
