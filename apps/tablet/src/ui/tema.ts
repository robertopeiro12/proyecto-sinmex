import { StyleSheet } from 'react-native';

/**
 * Tokens y estilos comunes del shell.
 *
 * Deliberadamente minimo: T-04 es el esqueleto de navegacion, no el diseno de
 * la app. Los tamanos estan pensados para **tablet en horizontal** y para dedos
 * (objetivos tactiles de 56 px o mas), no para un telefono.
 */
export const colores = {
  fondo: '#F5F7FA',
  superficie: '#FFFFFF',
  borde: '#D8DEE7',
  texto: '#16202E',
  textoSuave: '#5A6779',
  primario: '#0B6BCB',
  primarioTexto: '#FFFFFF',
  alerta: '#B23A2E',
  exito: '#177245',
} as const;

export const espacio = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const estilos = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: colores.fondo,
    padding: espacio.lg,
  },
  titulo: {
    fontSize: 28,
    fontWeight: '700',
    color: colores.texto,
    marginBottom: espacio.xs,
  },
  subtitulo: {
    fontSize: 16,
    color: colores.textoSuave,
    marginBottom: espacio.lg,
  },
  tarjeta: {
    backgroundColor: colores.superficie,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.md,
    marginBottom: espacio.md,
  },
  // Rejilla de 2 columnas: aprovecha el ancho de la tablet en horizontal.
  rejilla: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espacio.md,
  },
  celdaRejilla: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 96,
    justifyContent: 'center',
  },
  etiqueta: {
    fontSize: 14,
    fontWeight: '600',
    color: colores.textoSuave,
    marginBottom: espacio.xs,
    textTransform: 'uppercase',
  },
  textoTarjeta: {
    fontSize: 20,
    fontWeight: '600',
    color: colores.texto,
  },
  textoSuave: {
    fontSize: 14,
    color: colores.textoSuave,
    marginTop: espacio.xs,
  },
  campo: {
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: 8,
    backgroundColor: colores.superficie,
    paddingHorizontal: espacio.md,
    paddingVertical: espacio.sm,
    fontSize: 22,
    color: colores.texto,
    minHeight: 56,
  },
  boton: {
    backgroundColor: colores.primario,
    borderRadius: 8,
    paddingHorizontal: espacio.lg,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonTexto: {
    color: colores.primarioTexto,
    fontSize: 18,
    fontWeight: '700',
  },
  botonDeshabilitado: {
    opacity: 0.4,
  },
  error: {
    color: colores.alerta,
    fontSize: 15,
    marginTop: espacio.sm,
  },
});
