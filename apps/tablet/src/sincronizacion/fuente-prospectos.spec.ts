import { depsDePrueba, snapshotDePrueba } from '@/datos/pruebas-apoyo';
import { crearRepositorioCatalogos } from '@/datos/repositorios/catalogos';
import { crearRepositorioProspectos } from '@/datos/repositorios/prospectos';

import type { DatosProspecto } from './contrato';
import { fuenteProspectos } from './fuente-prospectos';

function montar() {
  const deps = depsDePrueba();
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const prospectos = crearRepositorioProspectos(deps, { catalogos });
  return { prospectos, fuente: fuenteProspectos(prospectos) };
}

const captura = (extra: Record<string, unknown> = {}) => ({
  vendedorId: 'ven-1',
  sucursalId: 'suc-tj',
  nombre: 'Tacos Aaron',
  telefono: '6641112233',
  encargado: 'Don Aaron',
  tipoNegocioId: 'tn-2',
  comentarios: 'Quiere probar jamaica',
  lat: 32.5149,
  lng: -117.0382,
  ...extra,
});

describe('fuenteProspectos', () => {
  it('declara el tipo de operacion `prospecto`', () => {
    expect(montar().fuente.tipo).toBe('prospecto');
  });

  it('sin nada capturado no manda nada', () => {
    expect(montar().fuente.pendientes()).toEqual([]);
  });

  it('arma el sobre con la clave, la fecha local y los datos', () => {
    const { prospectos, fuente } = montar();
    const p = prospectos.registrar(captura());

    const ops = fuente.pendientes();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      // La clave de idempotencia es el `id` de la fila: no cambia, y reenviar el
      // lote no puede duplicar el prospecto.
      clave: p.id,
      tipo: 'prospecto',
      // Dia de trabajo con el reloj local de la tablet, no derivado de UTC.
      fecha_operacion: '2026-08-07',
      ocurrido_en: '2026-08-07T15:00:00.000Z',
      datos: {
        nombre: 'Tacos Aaron',
        telefono: '6641112233',
        encargado: 'Don Aaron',
        tipo_negocio_id: 'tn-2',
        comentarios: 'Quiere probar jamaica',
        lat: 32.5149,
        lng: -117.0382,
        foto: null,
      } satisfies DatosProspecto,
    });
  });

  /**
   * Un prospecto **no se refiere** a un cliente: lo esta creando. Y no lleva
   * folio, porque no es una nota que nadie firme — si lo llevara, quemaria un
   * numero del contador del dia (ADR-0001) y el servidor ademas lo rechazaria.
   */
  it('no manda `cliente_id` ni `folio`', () => {
    const { prospectos, fuente } = montar();
    prospectos.registrar(captura());

    const [op] = fuente.pendientes();
    expect(op).toBeDefined();
    expect(op?.cliente_id).toBeUndefined();
    expect(op?.folio).toBeUndefined();
  });

  it('manda la ubicacion en null cuando no se pudo obtener', () => {
    const { prospectos, fuente } = montar();
    prospectos.registrar(captura({ lat: null, lng: null }));

    expect(fuente.pendientes()[0]?.datos).toMatchObject({ lat: null, lng: null });
  });

  it('marcarSincronizada y marcarError llegan al repositorio', () => {
    const { prospectos, fuente } = montar();
    const uno = prospectos.registrar(captura({ nombre: 'Uno' }));
    const dos = prospectos.registrar(captura({ nombre: 'Dos' }));

    fuente.marcarSincronizada(uno.id);
    fuente.marcarError(dos.id, 'tipo-negocio-inexistente: ya no existe');

    expect(prospectos.porId(uno.id)?.sync_estado).toBe('sincronizado');
    expect(prospectos.porId(dos.id)).toMatchObject({
      sync_estado: 'error',
      sync_error: 'tipo-negocio-inexistente: ya no existe',
    });
    // El rechazado sigue en la cola: se reintenta en la siguiente pasada.
    expect(fuente.pendientes().map((o) => o.clave)).toEqual([dos.id]);
  });
});
