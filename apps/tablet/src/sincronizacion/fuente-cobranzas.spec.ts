import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioCobranzas } from '@/datos/repositorios/cobranzas';
import { crearRepositorioFolios } from '@/datos/repositorios/folios';

import { fuenteCobranzas } from './fuente-cobranzas';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const cobranzas = crearRepositorioCobranzas(deps, {
    catalogos,
    folios: crearRepositorioFolios(deps),
  });
  return { cobranzas, fuente: fuenteCobranzas(cobranzas) };
}

const cobro = {
  vendedorId: 'ven-1',
  clienteId: 'cli-1',
  ventaNotaId: 'nota-1',
  montoCentavos: 5000,
  metodoPago: 'cheque' as const,
  fechaPago: '2026-08-06',
};

describe('fuente de cobranzas (T-20)', () => {
  it('sin cobros no hay nada que subir', () => {
    const { fuente } = montar();
    expect(fuente.tipo).toBe('cobranza');
    expect(fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre exacto del contrato: cliente y folio en el sobre, el pago en datos', () => {
    const { cobranzas, fuente } = montar();
    const c = cobranzas.registrar(cobro);

    expect(fuente.pendientes()).toEqual([
      {
        // La clave es el id de la fila: no cambia entre reintentos.
        clave: c.id,
        tipo: 'cobranza',
        fecha_operacion: '2026-08-07',
        ocurrido_en: '2026-08-07T15:00:00.000Z',
        cliente_id: 'cli-1',
        folio: 'TJ260807AP01',
        datos: {
          venta_nota_id: 'nota-1',
          monto_centavos: 5000,
          metodo_pago: 'cheque',
          fecha_pago: '2026-08-06',
        },
      },
    ]);
  });

  it('un cobro aceptado sale de la cola', () => {
    const { cobranzas, fuente } = montar();
    const c = cobranzas.registrar(cobro);
    fuente.marcarSincronizada(c.id);
    expect(fuente.pendientes()).toEqual([]);
    expect(cobranzas.porId(c.id)?.sync_estado).toBe('sincronizado');
  });

  it('un cobro rechazado guarda el motivo y se vuelve a mandar en la siguiente sincronizacion', () => {
    const { cobranzas, fuente } = montar();
    const c = cobranzas.registrar(cobro);
    fuente.marcarError(c.id, 'nota-no-encontrada: la nota no existe');
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([c.id]);
    expect(cobranzas.porId(c.id)?.sync_error).toBe('nota-no-encontrada: la nota no existe');
  });
});
