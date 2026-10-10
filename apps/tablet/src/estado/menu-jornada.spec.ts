import { estadoMenuJornada, textoConfirmarCierre } from './menu-jornada';

describe('estadoMenuJornada (T-38, D6 capa 2)', () => {
  it('con la jornada abierta todo esta habilitado y no hay aviso', () => {
    expect(estadoMenuJornada({ estado: 'abierta', km_final: null })).toEqual({
      operacionesHabilitadas: true,
      avisoDiaCerrado: null,
    });
  });

  it('sin jornada no deshabilita nada: el guardia de navegacion ya redirige', () => {
    expect(estadoMenuJornada(null)).toEqual({
      operacionesHabilitadas: true,
      avisoDiaCerrado: null,
    });
  });

  it('con la jornada cerrada se deshabilitan las operaciones y aparece el aviso con el km final', () => {
    expect(estadoMenuJornada({ estado: 'cerrada', km_final: 128512 })).toEqual({
      operacionesHabilitadas: false,
      avisoDiaCerrado:
        'Día cerrado · km final 128512 · lo capturado sube con «Sincronizar ahora»',
    });
  });

  it('el km final con decimal se muestra tal cual', () => {
    expect(estadoMenuJornada({ estado: 'cerrada', km_final: 128712.5 }).avisoDiaCerrado).toContain(
      'km final 128712.5',
    );
  });
});

describe('textoConfirmarCierre (T-38, D6 capa 1)', () => {
  it('advierte que despues no se podra operar y repite el km final', () => {
    expect(textoConfirmarCierre(128512)).toBe(
      'Después de cerrar el día ya no podrás vender, cobrar ni registrar prospectos en esta tablet. ¿Cerrar el día con km final 128512?',
    );
  });
});
