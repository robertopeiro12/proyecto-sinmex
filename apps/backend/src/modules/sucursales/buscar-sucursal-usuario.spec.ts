import { buscarSucursalUsuario } from './buscar-sucursal-usuario';

describe('buscarSucursalUsuario', () => {
  it('arma la consulta esperada contra la tabla usuario', async () => {
    const ejecutar = jest.fn().mockResolvedValue({ id: '1', codigo: 'TJ' });
    const builder = {
      selectFrom: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      executeTakeFirst: ejecutar,
    };
    const db = builder as unknown as Parameters<
      typeof buscarSucursalUsuario
    >[0];

    const resultado = await buscarSucursalUsuario(db, 'usuario-1');

    expect(builder.selectFrom).toHaveBeenCalledWith('usuario');
    expect(builder.leftJoin).toHaveBeenCalledWith(
      'sucursal',
      'sucursal.id',
      'usuario.sucursal_id',
    );
    expect(builder.where).toHaveBeenCalledWith('usuario.id', '=', 'usuario-1');
    expect(builder.where).toHaveBeenCalledWith(
      'usuario.deleted_at',
      'is',
      null,
    );
    expect(resultado).toEqual({ id: '1', codigo: 'TJ' });
  });
});
