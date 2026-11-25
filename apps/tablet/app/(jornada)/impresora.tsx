import { useState } from 'react';
import { Text, View } from 'react-native';

import { useJawa } from '@/estado/proveedor-jawa';
import type { ResultadoImpresion } from '@/impresion/controlador';
import type { Papel } from '@/impresion/html';
import { ticketDePrueba } from '@/impresion/prueba';
import { useImpresion } from '@/impresion/usar-impresion';
import { Boton } from '@/ui/boton';
import { Chip } from '@/ui/chip';
import { Icono } from '@/ui/icono';
import { MarcoMenu } from '@/ui/marco-menu';
import { Pantalla, Tarjeta, type Estado } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio } from '@/ui/tokens';

const PAPELES: { papel: Papel; etiqueta: string }[] = [
  { papel: 58, etiqueta: '58 mm' },
  { papel: 80, etiqueta: '80 mm' },
];

/** Lo que se le dice al vendedor despues de "Imprimir prueba". */
function mensaje(r: ResultadoImpresion): { estado: Estado; etiqueta: string; texto: string } {
  if (r.ok) {
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
  return {
    estado: 'error',
    etiqueta: 'No se pudo imprimir',
    texto: r.detalle ? `Android respondió: ${r.detalle}` : 'Android no pudo abrir la impresión.',
  };
}

/**
 * "Seleccionar impresora" (rediseno pieza 7): el papel de la termica (58 u 80 mm)
 * y una nota de prueba. La impresora en si se elige en el dialogo de Android
 * (`expo-print`), asi que aqui no hay lista de dispositivos.
 */
export default function Impresora() {
  const { vendedor } = useJawa();
  const { estilos } = useTema();
  const { papel, elegirPapel, imprimirTicket } = useImpresion();
  const [imprimiendo, setImprimiendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImpresion | null>(null);
  const [errorPapel, setErrorPapel] = useState<string | null>(null);

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

  const imprimirPrueba = async () => {
    setImprimiendo(true);
    setResultado(null);
    try {
      setResultado(await imprimirTicket(ticketDePrueba(new Date().toISOString(), vendedor?.nombre)));
    } finally {
      setImprimiendo(false);
    }
  };

  const aviso = resultado ? mensaje(resultado) : null;

  return (
    <MarcoMenu clave="impresora" titulo="Seleccionar impresora">
      <Pantalla subtitulo="Las notas se imprimen con la impresora configurada en Android: al imprimir se abre su ventana para elegirla.">
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

        <Boton
          etiqueta="Imprimir prueba"
          icono="impresora"
          onPress={() => void imprimirPrueba()}
          ocupado={imprimiendo}
          deshabilitado={papel === null}
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
