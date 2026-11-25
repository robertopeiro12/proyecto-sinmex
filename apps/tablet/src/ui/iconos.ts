// Trazos de los iconos de la app. Puro (sin React Native) para poder probarlo
// con Jest. Caja de 24x24, trazo `currentColor` de 2.2, extremos redondeados:
// el mismo estilo de las maquetas del rediseno.

export type NombreIcono =
  | 'menu'
  | 'sincronizar'
  | 'agregar-cliente'
  | 'atras'
  | 'adelante'
  | 'cerrar'
  | 'palomita'
  | 'mas'
  | 'menos'
  | 'ubicacion'
  | 'telefono'
  | 'mapa'
  | 'nota'
  | 'candado'
  | 'camion'
  | 'inventario'
  | 'vender'
  | 'cobrar'
  | 'visita'
  | 'merma'
  | 'gasto'
  | 'corte'
  | 'prospecto'
  | 'impresora'
  | 'sugerido'
  | 'salir'
  | 'foto'
  | 'registros'
  | 'borrar';

export const TRAZOS: Record<NombreIcono, readonly string[]> = {
  menu: ['M3 6h18M3 12h18M3 18h18'],
  sincronizar: ['M21 12a9 9 0 0 1-15.5 6.2L3 16', 'M3 21v-5h5', 'M3 12a9 9 0 0 1 15.5-6.2L21 8', 'M21 3v5h-5'],
  'agregar-cliente': ['M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6M16 11h6'],
  atras: ['M15 5l-7 7 7 7'],
  adelante: ['M9 5l7 7-7 7'],
  cerrar: ['M6 6l12 12M18 6L6 18'],
  palomita: ['M5 12.5l4.5 4.5L19 7.5'],
  mas: ['M5 12h14M12 5v14'],
  menos: ['M5 12h14'],
  ubicacion: ['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  telefono: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z'],
  mapa: ['M9 4L3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5z', 'M9 4v14M15 6.5v14'],
  nota: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6M8 13h8M8 17h5'],
  candado: ['M7 11h10v9H7z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  camion: ['M3 6h11v10H3zM14 10h4l3 3v3h-7z', 'M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'],
  inventario: ['M21 8l-9-5-9 5v8l9 5 9-5z', 'M3 8l9 5 9-5M12 13v8'],
  vender: ['M6 3h12l-1.5 18h-9z', 'M6.5 9h11'],
  cobrar: ['M12 3v18', 'M16.5 7.5C16 6 14.3 5 12 5c-2.5 0-4.5 1.2-4.5 3.2 0 4.3 9 2 9 6.6 0 2-2 3.2-4.5 3.2-2.4 0-4.2-1.1-4.7-2.8'],
  visita: ['M3 9l9-6 9 6', 'M5 9v11h14V9', 'M10 20v-6h4v6'],
  merma: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14', 'M10 11v6M14 11v6'],
  gasto: ['M3 7h18v12H3z', 'M3 11h18', 'M7 15h4'],
  corte: ['M9 3h6a2 2 0 0 1 2 2v1H7V5a2 2 0 0 1 2-2z', 'M7 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1', 'M8 13l3 3 5-6'],
  prospecto: ['M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M20 20l-4-4'],
  impresora: ['M7 8V3h10v5', 'M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M7 14h10v7H7z'],
  sugerido: ['M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z'],
  salir: ['M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4', 'M16 8l4 4-4 4M20 12H9'],
  foto: ['M4 8h3l2-3h6l2 3h3v12H4z', 'M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  registros: ['M8 6h13M8 12h13M8 18h13', 'M3.5 6h.01M3.5 12h.01M3.5 18h.01'],
  borrar: ['M21 5H9l-6 7 6 7h12z', 'M12 9l6 6M18 9l-6 6'],
};

export const NOMBRES_ICONO = Object.keys(TRAZOS) as readonly NombreIcono[];
