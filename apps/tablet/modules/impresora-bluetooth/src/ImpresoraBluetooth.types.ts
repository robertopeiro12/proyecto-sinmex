/** Una impresora ya emparejada en los ajustes de Bluetooth de la tablet. */
export type ImpresoraEmparejada = {
  nombre: string;
  /** MAC del dispositivo, p. ej. `66:22:32:A1:B2:C3`. */
  direccion: string;
};

/** Los `code` con que el módulo nativo rechaza sus promesas. */
export type CodigoErrorImpresora =
  | 'sin-bluetooth'
  | 'bluetooth-apagado'
  | 'sin-permiso'
  | 'no-conecta'
  | 'fallo-envio';

/** La forma del módulo nativo `ImpresoraBluetooth` (solo Android). */
export type ModuloImpresoraBluetooth = {
  emparejadas(): Promise<ImpresoraEmparejada[]>;
  imprimir(direccion: string, bytesBase64: string): Promise<void>;
};
