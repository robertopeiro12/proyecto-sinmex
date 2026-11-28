import {
  ordenarInformacion,
  porProductoInformacion,
  type RenglonInformacion,
} from './reglas-informacion-produccion';

const r = (
  presentacionId: string,
  productoId: string,
  producto: string,
  volumen: string,
  produccion: number,
  compras: number,
): RenglonInformacion => ({
  presentacionId,
  productoId,
  producto,
  volumen,
  produccion,
  compras,
  total: produccion + compras,
});

describe('reglas de Información de Producción', () => {
  it('por producto suma produccion, compras y total y ordena por nombre', () => {
    const salida = porProductoInformacion([
      r('p1', 'b', 'Tamarindo', '1 L', 5, 1),
      r('p2', 'a', 'Horchata', '1 L', 10, 0),
      r('p3', 'a', 'Horchata', '500 ml', 3, 4),
    ]);
    expect(salida).toEqual([
      {
        presentacionId: null,
        productoId: 'a',
        producto: 'Horchata',
        volumen: '',
        produccion: 13,
        compras: 4,
        total: 17,
      },
      {
        presentacionId: null,
        productoId: 'b',
        producto: 'Tamarindo',
        volumen: '',
        produccion: 5,
        compras: 1,
        total: 6,
      },
    ]);
  });

  it('ordena por tamano (355 ml antes de 1 L) y luego por producto', () => {
    const salida = ordenarInformacion([
      r('p1', 'b', 'Tamarindo', '1 L', 1, 0),
      r('p2', 'a', 'Jamaica', '355 ml', 1, 0),
      r('p3', 'c', 'Horchata', '1 L', 1, 0),
    ]);
    expect(salida.map((x) => x.presentacionId)).toEqual(['p2', 'p3', 'p1']);
  });
});
