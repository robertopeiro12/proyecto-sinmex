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
     * > [!danger] La foto NO puede tener una forma de tumbar el alta
     * > El cliente la pidio *"si esto no se hace lento"*. Que la ruta llegue o no
     * > llegue **no cambia una sola validacion** de este insert: todo lo que podia
     * > fallar de la foto (permiso, camara, compresion, tamano) fallo antes, en
     * > `src/fotos/`, y en ese caso esto recibe `null`. Un prospecto sin foto es un
     * > prospecto completo, no uno a medias.
     */
    it('sin foto: se graba igual y queda como un prospecto completo', () => {
      const { prospectos } = montar();

      const p = prospectos.registrar(captura());

      expect(p).toMatchObject({
        foto_uri: null,
        foto_subida_en: null,
        foto_error: null,
        foto_descartada: 0,
        // Y lo que importa: el prospecto esta listo para subir, como cualquier otro.
        sync_estado: 'pendiente',
      });
      expect(prospectos.pendientesDeSincronizar().map((x) => x.id)).toEqual([p.id]);
    });

    it('con foto: se guarda la ruta y nace pendiente de subir', () => {
      const { prospectos } = montar();

      const p = prospectos.registrar(
        captura({ fotoUri: 'file:///cache/fachada.jpg' }),
      );

      expect(p).toMatchObject({
        foto_uri: 'file:///cache/fachada.jpg',
        foto_subida_en: null,
        foto_descartada: 0,
      });
    });

    it('`fotoUri` ni se pasa: el alta es la de siempre', () => {
      // El campo es opcional en el tipo a proposito, para que ninguna pantalla
      // tenga que mencionar la foto para dar de alta un prospecto.
      const { prospectos } = montar();
      const { fotoUri: _, ...sinCampo } = { ...captura(), fotoUri: undefined };

      expect(prospectos.registrar(sinCampo).foto_uri).toBeNull();
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
  /**
   * El estado de subida de la foto (T-40), que es un canal aparte.
   *
   * > [!danger] Todo este describe existe por una sola frase del diseno
   * > **Una foto que falla no puede tocar el estado del prospecto.** Es el unico
   * > fallo cuyo sintoma en produccion seria un cliente potencial perdido en
   * > silencio: la pantalla diria "rechazado" de un alta que el servidor acepto
   * > sin problemas, y nadie visitaria ese negocio.
   */
  describe('la foto', () => {
    /** Un prospecto con foto, ya aceptado por el servidor. */
    function conFotoSincronizada() {
      const { prospectos, deps } = montar();
      const p = prospectos.registrar(captura({ fotoUri: 'file:///cache/f.jpg' }));
      prospectos.marcarSincronizado(p.id);
      return { prospectos, deps, id: p.id };
    }

    describe('cuando es elegible para subir', () => {
      /**
       * > [!important] Antes del push no existe la fila `cliente` a la que la foto
       * > pertenece
       * > Subirla solo podria dar 404 o 409. Ese estado la tablet ya lo registra
       * > desde T-07: la elegibilidad no necesita ninguna bandera nueva.
       */
      it('NO se ofrece mientras el prospecto no este sincronizado', () => {
        const { prospectos } = montar();
        const p = prospectos.registrar(captura({ fotoUri: 'file:///cache/f.jpg' }));

        expect(prospectos.pendientesDeSubirFoto()).toEqual([]);

        prospectos.marcarSincronizado(p.id);
        expect(prospectos.pendientesDeSubirFoto().map((x) => x.id)).toEqual([p.id]);
      });

      it('tampoco si el servidor RECHAZO el prospecto', () => {
        // Una operacion rechazada no deja fila en el servidor (contrato §7), asi
        // que no hay `cliente` al que anotarle la foto.
        const { prospectos } = montar();
        const p = prospectos.registrar(captura({ fotoUri: 'file:///cache/f.jpg' }));
        prospectos.marcarError(p.id, 'tipo-negocio-inexistente: ya no existe');

        expect(prospectos.pendientesDeSubirFoto()).toEqual([]);
      });

      it('un prospecto sin foto nunca esta en la cola', () => {
        const { prospectos } = montar();
        const p = prospectos.registrar(captura());
        prospectos.marcarSincronizado(p.id);

        expect(prospectos.pendientesDeSubirFoto()).toEqual([]);
      });

      it('una foto ya subida sale de la cola y no vuelve', () => {
        const { prospectos, id } = conFotoSincronizada();

        prospectos.marcarFotoSubida(id, '2026-08-07T16:00:00.000Z');

        expect(prospectos.pendientesDeSubirFoto()).toEqual([]);
        expect(prospectos.porId(id)).toMatchObject({
          foto_subida_en: '2026-08-07T16:00:00.000Z',
          foto_error: null,
        });
      });

      it('una descartada sale de la cola PARA SIEMPRE', () => {
        // Es lo que corta el bucle: un 413 o un 415 son juicios sobre estos
        // bytes, y reintentarlos da la misma respuesta en cada sincronizacion.
        const { prospectos, id } = conFotoSincronizada();

        prospectos.descartarFoto(id, 'La foto pesa mas de lo que el servidor acepta.');

        expect(prospectos.pendientesDeSubirFoto()).toEqual([]);
        expect(prospectos.porId(id)).toMatchObject({
          foto_descartada: 1,
          foto_error: 'La foto pesa mas de lo que el servidor acepta.',
          // Se conserva la ruta: es la unica pista de que hubo una foto.
          foto_uri: 'file:///cache/f.jpg',
        });
      });

      it('una que fallo por red SIGUE en la cola', () => {
        const { prospectos, id } = conFotoSincronizada();

        prospectos.anotarErrorFoto(id, 'No se pudo contactar al servidor.');

        expect(prospectos.pendientesDeSubirFoto().map((x) => x.id)).toEqual([id]);
        expect(prospectos.porId(id)?.foto_error).toBe(
          'No se pudo contactar al servidor.',
        );
      });
    });

    /**
     * > [!danger] Las tres pruebas de aqui son LA prueba del diseno
     * > Si una de ellas falla, un fallo de subida de una foto opcional esta
     * > cambiando el estado de un alta que el servidor ya acepto — y el vendedor
     * > ve "rechazado" en un prospecto perfectamente valido.
     */
    describe('un fallo de la foto NO toca el estado del prospecto', () => {
      /** El estado del prospecto, sin una sola columna de foto. */
      const estadoDelProspecto = (
        prospectos: ReturnType<typeof montar>['prospectos'],
        id: string,
      ) => {
        const p = prospectos.porId(id);
        return {
          sync_estado: p?.sync_estado,
          sync_error: p?.sync_error,
          sincronizado_en: p?.sincronizado_en,
        };
      };

      it('anotarErrorFoto deja el prospecto exactamente como estaba', () => {
        const { prospectos, id } = conFotoSincronizada();
        const antes = estadoDelProspecto(prospectos, id);

        prospectos.anotarErrorFoto(id, 'El servidor respondio 500.');

        expect(estadoDelProspecto(prospectos, id)).toEqual(antes);
        expect(antes.sync_estado).toBe('sincronizado');
        // Y sigue fuera de la cola del push: si volviera, el servidor contestaria
        // `duplicada` y la fila se quedaria oscilando sin motivo.
        expect(prospectos.pendientesDeSincronizar()).toEqual([]);
      });

      it('descartarFoto deja el prospecto exactamente como estaba', () => {
        const { prospectos, id } = conFotoSincronizada();
        const antes = estadoDelProspecto(prospectos, id);

        prospectos.descartarFoto(id, 'El contenido no es un JPEG completo.');

        expect(estadoDelProspecto(prospectos, id)).toEqual(antes);
        expect(prospectos.pendientesDeSincronizar()).toEqual([]);
      });

      it('marcarFotoSubida tampoco lo toca', () => {
        // El aislamiento va en los dos sentidos: ni el exito ni el fallo de la
        // foto son noticias sobre el prospecto.
        const { prospectos, id } = conFotoSincronizada();
        const antes = estadoDelProspecto(prospectos, id);

        prospectos.marcarFotoSubida(id, '2026-08-07T16:00:00.000Z');

        expect(estadoDelProspecto(prospectos, id)).toEqual(antes);
      });

      it('y al reves: el push no toca ninguna columna de foto', () => {
        // `marcarError` de un rechazo del push no puede borrar el estado de una
        // foto que ya subio, ni resucitar una descartada.
        const { prospectos, id } = conFotoSincronizada();
        prospectos.marcarFotoSubida(id, '2026-08-07T16:00:00.000Z');

        prospectos.marcarError(id, 'fecha-futura: revisa el reloj');
        prospectos.marcarSincronizado(id);

        expect(prospectos.porId(id)).toMatchObject({
          foto_uri: 'file:///cache/f.jpg',
          foto_subida_en: '2026-08-07T16:00:00.000Z',
          foto_descartada: 0,
        });
      });
    });
  });
});
