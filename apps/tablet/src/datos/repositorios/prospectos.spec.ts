import { depsDePrueba, snapshotDePrueba } from '../pruebas-apoyo';
import { crearRepositorioCatalogos } from './catalogos';
import { crearRepositorioProspectos, ErrorProspecto } from './prospectos';

const VENDEDOR = 'ven-1';
const SUCURSAL = 'suc-tj';

function montar(momento?: string) {
  const deps = depsDePrueba(momento);
  const catalogos = crearRepositorioCatalogos(deps);
  catalogos.guardarSnapshot(snapshotDePrueba());
  const prospectos = crearRepositorioProspectos(deps, { catalogos });
  return { deps, catalogos, prospectos };
}

const captura = (extra: Record<string, unknown> = {}) => ({
  vendedorId: VENDEDOR,
  sucursalId: SUCURSAL,
  nombre: 'Tacos Aaron',
  telefono: '6641112233',
  encargado: 'Don Aaron',
  tipoNegocioId: 'tn-2',
  comentarios: 'Quiere probar jamaica',
  lat: 32.5149,
  lng: -117.0382,
  ...extra,
});

describe('repositorio de prospectos', () => {
  describe('registrar', () => {
    it('graba los campos que dicto el cliente, pendiente de subir', () => {
      const { prospectos } = montar();

      const p = prospectos.registrar(captura());

      expect(p).toMatchObject({
        fecha: '2026-08-07',
        vendedor_id: VENDEDOR,
        sucursal_id: SUCURSAL,
        nombre: 'Tacos Aaron',
        telefono: '6641112233',
        encargado: 'Don Aaron',
        tipo_negocio_id: 'tn-2',
        comentarios: 'Quiere probar jamaica',
        lat: 32.5149,
        lng: -117.0382,
        sync_estado: 'pendiente',
        sync_error: null,
        sincronizado_en: null,
      });
      expect(p.id).toBeTruthy();
      expect(p.grabado_en).toBe('2026-08-07T15:00:00.000Z');
    });

    /**
     * La foto **no se captura todavia**: falta decidir donde se guarda el
     * archivo. La columna existe para que ese ticket sea una pantalla y un
     * upload, no una migracion que rehaga la tabla en tablets ya instaladas.
     */
    it('deja `foto_uri` en null: la captura de la foto es un ticket aparte', () => {
      const { prospectos } = montar();
      expect(prospectos.registrar(captura()).foto_uri).toBeNull();
    });

    /**
     * Un prospecto NO lleva folio: no es una nota que el cliente firme. Si lo
     * llevara, cada alta quemaria un numero del contador del dia (ADR-0001) y
     * los folios de las ventas saldrian con huecos.
     */
    it('no emite folio ni toca el contador del dia', () => {
      const { deps, prospectos } = montar();
      prospectos.registrar(captura());
      prospectos.registrar(captura({ nombre: 'Tortas Luis' }));

      expect(deps.bd.getAllSync('select * from folio_emitido')).toEqual([]);
      expect(deps.bd.getAllSync('select * from folio_contador')).toEqual([]);
    });

    it('el nombre del negocio y el telefono son obligatorios', () => {
      const { prospectos } = montar();

      expect(() => prospectos.registrar(captura({ nombre: '   ' }))).toThrow(
        ErrorProspecto,
      );
      expect(() => prospectos.registrar(captura({ telefono: '' }))).toThrow(
        /teléfono/i,
      );
    });

    it('recorta los espacios y guarda los opcionales vacios como null', () => {
      const { prospectos } = montar();

      const p = prospectos.registrar(
        captura({
          nombre: '  Tacos Aaron  ',
          telefono: ' 664 ',
          encargado: '   ',
          comentarios: '',
        }),
      );

      expect(p).toMatchObject({
        nombre: 'Tacos Aaron',
        telefono: '664',
        encargado: null,
        comentarios: null,
      });
    });

    it('respeta los mismos topes de largo que el servidor', () => {
      const { prospectos } = montar();

      expect(() =>
        prospectos.registrar(captura({ nombre: 'x'.repeat(201) })),
      ).toThrow(ErrorProspecto);
      expect(() =>
        prospectos.registrar(captura({ telefono: '6'.repeat(31) })),
      ).toThrow(ErrorProspecto);
      expect(() =>
        prospectos.registrar(captura({ encargado: 'x'.repeat(121) })),
      ).toThrow(ErrorProspecto);
      expect(() =>
        prospectos.registrar(captura({ comentarios: 'x'.repeat(501) })),
      ).toThrow(ErrorProspecto);
    });

    describe('tipo de negocio', () => {
      it('es opcional', () => {
        const { prospectos } = montar();
        expect(
          prospectos.registrar(captura({ tipoNegocioId: null })).tipo_negocio_id,
        ).toBeNull();
      });

      /**
       * Se comprueba aqui y no solo en el servidor porque el vendedor tiene el
       * negocio delante: enterarse mañana, al sincronizar, de que el giro que
       * eligio ya no existe no le sirve de nada.
       */
      it('rechaza uno que no esta en el catalogo local', () => {
        const { prospectos } = montar();
        expect(() =>
          prospectos.registrar(captura({ tipoNegocioId: 'no-existe' })),
        ).toThrow(/catálogo/i);
      });

      it('rechaza uno que el portal dio de baja', () => {
        const { prospectos } = montar();
        // `tn-3` baja en el snapshot con `activo: 0`: la fila esta, pero no se
        // puede asignar (politica de purga de T-07).
        expect(() =>
          prospectos.registrar(captura({ tipoNegocioId: 'tn-3' })),
        ).toThrow(ErrorProspecto);
      });
    });

    describe('ubicacion', () => {
      it('sin ubicacion se guarda igual: negar el permiso no bloquea el alta', () => {
        const { prospectos } = montar();

        const p = prospectos.registrar(captura({ lat: null, lng: null }));
        expect(p).toMatchObject({ lat: null, lng: null, sync_estado: 'pendiente' });
      });

      it('rechaza media coordenada', () => {
        const { prospectos } = montar();

        expect(() => prospectos.registrar(captura({ lat: null }))).toThrow(
          /ubicación/i,
        );
        expect(() => prospectos.registrar(captura({ lng: null }))).toThrow(
          ErrorProspecto,
        );
      });
    });

    it('una captura rechazada no deja fila', () => {
      const { prospectos } = montar();

      expect(() => prospectos.registrar(captura({ nombre: '' }))).toThrow();
      expect(prospectos.delDia(VENDEDOR)).toEqual([]);
    });

    /**
     * Dos negocios distintos pueden llamarse igual, asi que el alta **no** es
     * unica por nombre. La idempotencia la da la clave del push (el `id`), no el
     * contenido.
     */
    it('permite dos prospectos con el mismo nombre', () => {
      const { prospectos } = montar();

      const uno = prospectos.registrar(captura());
      const dos = prospectos.registrar(captura());

      expect(uno.id).not.toBe(dos.id);
      expect(prospectos.delDia(VENDEDOR)).toHaveLength(2);
    });
  });

  describe('delDia', () => {
    it('lista los del dia de este vendedor, en orden de captura', () => {
      const { prospectos } = montar();
      prospectos.registrar(captura({ nombre: 'Primero' }));
      prospectos.registrar(captura({ nombre: 'Segundo' }));

      expect(prospectos.delDia(VENDEDOR).map((p) => p.nombre)).toEqual([
        'Primero',
        'Segundo',
      ]);
    });

    it('no mezcla los de otro vendedor: la tablet puede compartirse', () => {
      const { deps, catalogos, prospectos } = montar();
      // `ven-2` existe en el catalogo (dado de baja, pero la fila esta).
      prospectos.registrar(captura({ vendedorId: 'ven-2', nombre: 'De Berta' }));
      prospectos.registrar(captura({ nombre: 'De Abraham' }));
      void deps;
      void catalogos;

      expect(prospectos.delDia(VENDEDOR).map((p) => p.nombre)).toEqual([
        'De Abraham',
      ]);
      expect(prospectos.delDia('ven-2').map((p) => p.nombre)).toEqual(['De Berta']);
    });

    it('no mezcla los de otro dia', () => {
      const ayer = montar('2026-08-06T15:00:00.000Z');
      ayer.prospectos.registrar(captura({ nombre: 'De ayer' }));

      expect(ayer.prospectos.delDia(VENDEDOR, '2026-08-07')).toEqual([]);
      expect(ayer.prospectos.delDia(VENDEDOR, '2026-08-06')).toHaveLength(1);
    });
  });

  describe('la cola del push', () => {
    it('los pendientes salen en orden de captura', () => {
      const { prospectos } = montar();
      prospectos.registrar(captura({ nombre: 'Primero' }));
      prospectos.registrar(captura({ nombre: 'Segundo' }));

      expect(prospectos.pendientesDeSincronizar().map((p) => p.nombre)).toEqual([
        'Primero',
        'Segundo',
      ]);
    });

    it('marcarSincronizado lo saca de la cola y limpia el error anterior', () => {
      const { prospectos } = montar();
      const p = prospectos.registrar(captura());

      prospectos.marcarError(p.id, 'tipo-negocio-inexistente: ya no existe');
      prospectos.marcarSincronizado(p.id);

      expect(prospectos.porId(p.id)).toMatchObject({
        sync_estado: 'sincronizado',
        sync_error: null,
        sincronizado_en: '2026-08-07T15:00:00.000Z',
      });
      expect(prospectos.pendientesDeSincronizar()).toEqual([]);
    });

    /**
     * Un rechazo NO es el final: `tipo-negocio-inexistente` se recupera en
     * cuanto el administrador arregla el catalogo, y reenviar es seguro porque
     * la clave es el `id` de la fila, que no cambia nunca.
     */
    it('un rechazado guarda el motivo y sigue en la cola para reintentarlo', () => {
      const { prospectos } = montar();
      const p = prospectos.registrar(captura());

      prospectos.marcarError(p.id, 'tipo-negocio-inexistente: ya no existe');

      expect(prospectos.porId(p.id)).toMatchObject({
        sync_estado: 'error',
        sync_error: 'tipo-negocio-inexistente: ya no existe',
      });
      expect(prospectos.pendientesDeSincronizar().map((x) => x.id)).toEqual([p.id]);
    });
  });
});
