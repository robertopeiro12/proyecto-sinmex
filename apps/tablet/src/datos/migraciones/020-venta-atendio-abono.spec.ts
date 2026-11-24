import type { BaseDatos } from '../base-datos';
import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from '../repositorios/catalogos';
import { migraciones, versionEsquema } from './index';

/**
 * La 020 (rediseno pieza 2) agrega a la venta quien atendio y el abono al
 * vender. Sin `check`: lo valida `ventas.registrar()`. Las ventas viejas quedan
 * con las dos columnas nulas.
 */

function baseAlDia(): BaseDatos {
  const deps = depsDePrueba();
  crearRepositorioCatalogos(deps).guardarSnapshot(snapshotDePrueba());
  return deps.bd;
}

describe('migracion 020: quien atendio y abono de la venta', () => {
  it('la 020 es la ultima y deja versionEsquema en 20', () => {
    expect(migraciones[19]?.nombre).toBe('venta-atendio-abono');
    expect(migraciones[19]?.version).toBe(20);
    expect(migraciones).toHaveLength(20);
    expect(versionEsquema(baseAlDia())).toBe(20);
  });

  it('una venta vieja queda con atendio_nombre y abono_centavos nulos', () => {
    const bd = baseAlDia();
    bd.runSync(
      `insert into venta (id, fecha, cliente_id, vendedor_id, sucursal_id, folio,
                          contado_credito, monto_total_centavos, grabada_en)
       values ('venta-vieja', '2026-08-07', 'cli-1', 'ven-1', 'suc-tj', 'TJ260807AP01',
               'credito', 80400, '2026-08-07T15:00:00.000Z')`,
    );
    expect(
      bd.getFirstSync('select atendio_nombre, abono_centavos from venta where id = $id', { $id: 'venta-vieja' }),
    ).toEqual({ atendio_nombre: null, abono_centavos: null });
  });

  it('guarda texto y entero', () => {
    const bd = baseAlDia();
    bd.runSync(
      `insert into venta (id, fecha, cliente_id, vendedor_id, sucursal_id, folio,
                          contado_credito, monto_total_centavos, grabada_en, atendio_nombre, abono_centavos)
       values ('venta-nueva', '2026-08-07', 'cli-1', 'ven-1', 'suc-tj', 'TJ260807AP01',
               'credito', 80400, '2026-08-07T15:00:00.000Z', 'Doña Lupe', 30000)`,
    );
    expect(
      bd.getFirstSync('select atendio_nombre, abono_centavos from venta where id = $id', { $id: 'venta-nueva' }),
    ).toEqual({ atendio_nombre: 'Doña Lupe', abono_centavos: 30000 });
  });
});
