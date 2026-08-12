import {
  ReconciliacionInvalida,
  reconciliarPresentaciones,
} from './reconciliar-presentaciones';

const EXISTENTE_A = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  volumen: '500 ml',
};
const EXISTENTE_B = {
  id: 'bbbbbbbb-0000-0000-0000-000000000002',
  volumen: '1 Litro',
};

describe('reconciliarPresentaciones', () => {
  it('inserta las filas que llegan sin id', () => {
    const plan = reconciliarPresentaciones([], [{ volumen: '500 ml' }]);

    expect(plan.insertar).toEqual([{ volumen: '500 ml' }]);
    expect(plan.actualizar).toEqual([]);
    expect(plan.darDeBaja).toEqual([]);
  });

  it('actualiza las filas que llegan con id conocido', () => {
    const plan = reconciliarPresentaciones(
      [EXISTENTE_A],
      [{ id: EXISTENTE_A.id, volumen: '600 ml' }],
    );

    expect(plan.actualizar).toEqual([
      { id: EXISTENTE_A.id, volumen: '600 ml' },
    ]);
    expect(plan.insertar).toEqual([]);
    expect(plan.darDeBaja).toEqual([]);
  });

  it('da de baja las existentes que el payload no menciona', () => {
    const plan = reconciliarPresentaciones(
      [EXISTENTE_A, EXISTENTE_B],
      [{ id: EXISTENTE_A.id, volumen: '500 ml' }],
    );

    expect(plan.darDeBaja).toEqual([EXISTENTE_B.id]);
  });

  it('no marca como actualizacion una fila cuyo volumen no cambio', () => {
    const plan = reconciliarPresentaciones(
      [EXISTENTE_A],
      [{ id: EXISTENTE_A.id, volumen: '500 ml' }],
    );

    // Un update que no cambia nada mueve `updated_at`, y el pull de T-07 es
    // incremental: la tablet se bajaria la fila entera sin motivo.
    expect(plan.actualizar).toEqual([]);
  });

  it('combina alta, edicion y baja en una sola pasada', () => {
    const plan = reconciliarPresentaciones(
      [EXISTENTE_A, EXISTENTE_B],
      [{ id: EXISTENTE_A.id, volumen: '600 ml' }, { volumen: '2 Litros' }],
    );

    expect(plan.actualizar).toEqual([
      { id: EXISTENTE_A.id, volumen: '600 ml' },
    ]);
    expect(plan.insertar).toEqual([{ volumen: '2 Litros' }]);
    expect(plan.darDeBaja).toEqual([EXISTENTE_B.id]);
  });

  it('rechaza un id que no pertenece a este producto', () => {
    // Sin esta comprobacion el update no encontraria la fila y el PATCH
    // respondería 200 habiendo ignorado en silencio lo que le pidieron.
    expect(() =>
      reconciliarPresentaciones(
        [EXISTENTE_A],
        [{ id: EXISTENTE_B.id, volumen: 'x' }],
      ),
    ).toThrow(ReconciliacionInvalida);
  });

  it('rechaza dos volumenes iguales dentro del mismo payload', () => {
    // El unique de la base tambien lo atraparia, pero como 23505 generico. Aqui
    // se puede decir cual es el volumen repetido.
    expect(() =>
      reconciliarPresentaciones(
        [],
        [{ volumen: '500 ml' }, { volumen: '500 ml' }],
      ),
    ).toThrow(ReconciliacionInvalida);
  });

  it('trata distinta capitalizacion y espacios como el mismo volumen', () => {
    expect(() =>
      reconciliarPresentaciones(
        [],
        [{ volumen: '500 ML' }, { volumen: ' 500 ml ' }],
      ),
    ).toThrow(ReconciliacionInvalida);
  });

  it('rechaza quedarse sin ninguna presentacion', () => {
    expect(() => reconciliarPresentaciones([EXISTENTE_A], [])).toThrow(
      ReconciliacionInvalida,
    );
  });

  it('permite reusar un volumen que la misma peticion da de baja', () => {
    // Quitar "500 ml" y agregarlo de nuevo en el mismo guardado: el volumen
    // libre no debe chocar consigo mismo. Ojo: sale con id NUEVO, y eso es
    // justo el cabo suelto que el spec le deja anotado a T-18.
    const plan = reconciliarPresentaciones(
      [EXISTENTE_A],
      [{ volumen: '500 ml' }],
    );

    expect(plan.darDeBaja).toEqual([EXISTENTE_A.id]);
    expect(plan.insertar).toEqual([{ volumen: '500 ml' }]);
  });
});
