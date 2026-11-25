import Svg, { Path } from 'react-native-svg';

import { TRAZOS, type NombreIcono } from './iconos';

/**
 * Icono de la app: SVG de trazo, del `color` que se le pase (normalmente el
 * del texto del boton). Es decorativo para TalkBack: la etiqueta la lleva el
 * boton, por eso `accessible={false}`.
 */
export function Icono({ nombre, tamano = 20, color }: { nombre: NombreIcono; tamano?: number; color: string }) {
  return (
    <Svg width={tamano} height={tamano} viewBox="0 0 24 24" accessible={false}>
      {TRAZOS[nombre].map((d) => (
        <Path key={d} d={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}
