import {
  MOTIVO_VENTA_INEXISTENTE,
  motivoAlAsignar,
  motivoAlQuitar,
  normalizarNumeroFactura,
  type VentaParaFacturar,
} from './facturas';

const CLIENTE = 'c1';
const venta = (extra: Partial<VentaParaFacturar> = {}): VentaParaFacturar => ({
  id: 'v1',
  folio: 'TJ261007AP01',
  clienteId: CLIENTE,
  status: 'pendiente',
  facturaId: null,
  facturaNumero: null,
  ...extra,
});

describe('normalizarNumeroFactura', () => {
  it('recorta y acepta de 1 a 30 caracteres', () => {
    expect(normalizarNumeroFactura('  A780 ')).toBe('A780');
    expect(normalizarNumeroFactura('9'.repeat(30))).toBe('9'.repeat(30));
  });
  it('en blanco o de mas de 30 es null', () => {
    expect(normalizarNumeroFactura('   ')).toBeNull();
    expect(normalizarNumeroFactura('9'.repeat(31))).toBeNull();
  });
});

describe('motivoAlAsignar', () => {
  it('todo en orden es null', () => {
    expect(motivoAlAsignar(['v1'], [venta()], CLIENTE)).toBeNull();
  });
  it('una venta que no llego (no existe o esta eliminada)', () => {
    expect(motivoAlAsignar(['v1', 'v2'], [venta()], CLIENTE)).toBe(
      MOTIVO_VENTA_INEXISTENTE,
    );
  });
  it('de otro cliente', () => {
    expect(motivoAlAsignar(['v1'], [venta({ clienteId: 'c2' })], CLIENTE)).toBe(
      'La venta TJ261007AP01 no es de este cliente.',
    );
  });
  it('de promocion', () => {
    expect(
      motivoAlAsignar(['v1'], [venta({ status: 'promocion' })], CLIENTE),
    ).toBe('La venta TJ261007AP01 es de promoción ($0): no se factura.');
  });
  it('ya facturada', () => {
    expect(
      motivoAlAsignar(
        ['v1'],
        [venta({ facturaId: 'f1', facturaNumero: 'A780' })],
        CLIENTE,
      ),
    ).toBe('La venta TJ261007AP01 ya está en la factura A780.');
  });
});

describe('motivoAlQuitar', () => {
  it('todas en la factura es null', () => {
    expect(
      motivoAlQuitar(['v1'], [venta({ facturaId: 'f1' })], 'f1', 'A780'),
    ).toBeNull();
  });
  it('una que no esta en esa factura', () => {
    expect(
      motivoAlQuitar(['v1'], [venta({ facturaId: 'f2' })], 'f1', 'A780'),
    ).toBe('La venta TJ261007AP01 no está en la factura A780.');
  });
  it('una que no llego', () => {
    expect(motivoAlQuitar(['v1'], [], 'f1', 'A780')).toBe(
      MOTIVO_VENTA_INEXISTENTE,
    );
  });
});
