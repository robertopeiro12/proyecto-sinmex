import { Text, type TextStyle } from 'react-native';

import { useTema } from './tema';
import { colores, fuente, tipo } from './tokens';

/**
 * Cualquier numero que el vendedor lea o compare: dinero, cantidades,
 * kilometraje, [[Folios|folios]], contadores de sincronizacion.
 *
 * > [!important] Esto no es una eleccion estetica
 * > La tipografia de texto tiene anchos distintos por digito: un `1` ocupa
 * > menos que un `8`. En una lista de saldos eso **desalinea la columna** y
 * > obliga a leer numero por numero. Con la monoespaciada, la columna cuadra
 * > sola y el vendedor detecta de un vistazo el que no encaja.
 *
 * Y en un [[Folios|folio]] como `TJ260322AP05` la monoespaciada separa los seis
 * segmentos visualmente, lo que hace mucho mas dificil confundir un `0` con una
 * `O` o un `1` con una `l` al dictarlo por telefono a la oficina.
 *
 * ```tsx
 * <Cifra valor={folio} tamano="cuerpo" />
 * <Cifra valor={total} tamano="grande" tono="exito" />
 * ```
 */
export function Cifra({
  valor,
  tamano = 'cuerpo',
  tono = 'tinta',
  estilo,
}: {
  valor: string | number;
  /** `grande` para el numero protagonista de la pantalla. */
  tamano?: 'grande' | 'destacado' | 'cuerpo' | 'menor';
  tono?: 'tinta' | 'suave' | 'primario' | 'peligro' | 'exito' | 'aviso' | 'inversa';
  estilo?: TextStyle;
}) {
  const { t } = useTema();

  const tamanos = {
    grande: tipo.cifraGrande,
    destacado: tipo.destacado,
    cuerpo: tipo.cuerpo,
    menor: tipo.menor,
  } as const;

  const tonos = {
    tinta: colores.tinta,
    suave: colores.tintaSuave,
    primario: colores.primario,
    peligro: colores.peligro,
    exito: colores.exito,
    aviso: colores.aviso,
    inversa: colores.tintaInversa,
  } as const;

  const px = t(tamanos[tamano]);

  return (
    <Text
      style={[
        {
          fontFamily: tamano === 'grande' ? fuente.cifraFuerte : fuente.cifra,
          fontSize: px,
          lineHeight: px * 1.25,
          color: tonos[tono],
          // La monoespaciada ya viene apretada; un pelo de aire ayuda a
          // separar los segmentos de un folio.
          letterSpacing: 0.4,
        },
        estilo,
      ]}
    >
      {valor}
    </Text>
  );
}

/**
 * Formatea centavos enteros como pesos.
 *
 * El dinero vive en **centavos enteros** en toda la app (ver `ADR-0004`:
 * SQLite no tiene `numeric` y el corte de caja cuadra contra efectivo fisico).
 * Esta es la unica frontera donde eso se vuelve texto, para que nadie divida
 * entre 100 por su cuenta en una pantalla.
 */
export function pesos(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const enteros = Math.floor(abs / 100).toLocaleString('es-MX');
  const dec = String(abs % 100).padStart(2, '0');
  return `${signo}$${enteros}.${dec}`;
}
