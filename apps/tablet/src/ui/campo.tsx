import { useState } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTema } from './tema';
import { colores } from './tokens';

/**
 * Campo de captura con su etiqueta.
 *
 * `cifra` cambia la tipografia a monoespaciada y el teclado a numerico. Se usa
 * en todo lo que sea cantidad, dinero o kilometraje: el vendedor captura
 * decenas de numeros al dia y el teclado completo le cuesta un toque extra
 * cada vez, ademas de exponerlo a teclear letras donde no van.
 */
export function Campo({
  etiqueta,
  cifra = false,
  invalido = false,
  ayuda,
  ...props
}: TextInputProps & {
  etiqueta: string;
  /** Numeros: monoespaciada + teclado numerico. */
  cifra?: boolean;
  invalido?: boolean;
  ayuda?: string;
}) {
  const { estilos } = useTema();
  const [enfocado, setEnfocado] = useState(false);

  return (
    <View>
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <TextInput
        placeholderTextColor={colores.tintaSuave}
        keyboardType={cifra ? 'number-pad' : props.keyboardType}
        {...props}
        onFocus={(e) => {
          setEnfocado(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setEnfocado(false);
          props.onBlur?.(e);
        }}
        style={[
          estilos.campo,
          cifra && estilos.campoCifra,
          // El invalido gana al enfocado: si el dato esta mal, eso es lo que
          // el vendedor tiene que ver, aunque el cursor este dentro.
          enfocado && !invalido && estilos.campoEnfocado,
          invalido && estilos.campoInvalido,
          props.style,
        ]}
      />
      {ayuda ? <Text style={[estilos.textoSuave, { marginTop: -8 }]}>{ayuda}</Text> : null}
    </View>
  );
}
