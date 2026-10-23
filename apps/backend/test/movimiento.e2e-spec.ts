import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import { iniciarEnLocal } from './apoyo-servidor';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';
import {
  CONTRATO_ACTUAL,
  type RespuestaPull,
  type RespuestaPush,
} from './../src/modules/sincronizacion/contrato';

/**
 * T-27 pieza 2: los movimientos de inventario en el push, de punta a punta, y
 * `consumo_diario_max` en el pull. La clave es el id del movimiento, la fecha es
 * la del sobre, el servidor no revisa el limite de consumo ni la existencia, un
 * id ocupado se rechaza con motivo neutro y el reenvio es `duplicada`.
 *
 * Sucursal propia `ZM` (exclusiva de esta suite): cambiar su limite no afecta a
 * TJ ni a MX. Fechas de 2018-05 para no cruzarse con otras suites.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const CODIGO = 'ZM';
const PASSWORD = 'contrasena-del-vendedor';
const LOGIN = `e2e-movimiento-${SUFIJO}`;
const LOGIN_GENERAL = `e2e-movimiento-gen-${SUFIJO}`;
const PREFIJO = `ZZ-movimiento-${SUFIJO}`;
const FECHA = '2018-05-10';

interface FilaMovimiento {
  id: string;
  sucursal_id: string;
  vendedor_id: string;
  cliente_id: string | null;
  tipo: string;
  comentario: string | null;
  fecha_texto: string;
  registrado_en: Date;
}

describe('Movimientos de inventario en el push (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sucursalId: string;
  let usuarioId: string;
  let cookieGeneral: string;
  let vendedorId: string;
  let bearer: string;
  let clienteId: string;
  let clienteAjenoId: string;
  let productoId: string;
  let litro: string;
  let medio: string;

  const push = async (operaciones: unknown[]) => {
    const res = await request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones })
      .expect(200);
    return res.body as RespuestaPush;
  };

  const pull = async (desde?: string): Promise<RespuestaPull> => {
    const params = new URLSearchParams({ contrato: String(CONTRATO_ACTUAL) });
    if (desde) params.set('desde', desde);
    const res = await request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return res.body as RespuestaPull;
  };

  const patchSucursal = (cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/sucursales/${sucursalId}`)
      .set('Cookie', cookieGeneral)
      .send(cuerpo);

  /** Una merma del cliente: 3 litros danados, 2 medios de reposicion. */
  const mermaCliente = (
    datos: Record<string, unknown> = {},
    sobre: Record<string, unknown> = {},
  ) => ({
    clave: randomUUID(),
    tipo: 'movimiento',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:40:00.000Z`,
    cliente_id: clienteId,
    datos: {
      tipo: 'merma_cliente',
      comentario: null,
      registrado_en: `${FECHA}T18:40:00.000Z`,
      lineas: [
        { presentacion_id: litro, sentido: 'recibido', piezas: 3 },
        { presentacion_id: medio, sentido: 'entregado', piezas: 2 },
      ],
      ...datos,
    },
    ...sobre,
  });

  /** Merma del trayecto o consumo: sin `cliente_id`, solo piezas que salen. */
  const sinCliente = (tipo: 'merma_trayecto' | 'consumo', piezas = 1) => ({
    clave: randomUUID(),
    tipo: 'movimiento',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T19:00:00.000Z`,
    datos: {
      tipo,
      comentario: null,
      registrado_en: `${FECHA}T19:00:00.000Z`,
      lineas: [{ presentacion_id: litro, sentido: 'entregado', piezas }],
    },
  });

  const altaProspecto = () => ({
    clave: randomUUID(),
    tipo: 'prospecto',
    fecha_operacion: FECHA,
    ocurrido_en: `${FECHA}T18:03:22.000Z`,
    datos: {
      nombre: `${PREFIJO} Prospecto ${Math.random().toString(36).slice(2)}`,
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipo_negocio_id: null,
      comentarios: null,
      lat: null,
      lng: null,
      foto: null,
    },
  });

  const filaMovimiento = (id: string): Promise<FilaMovimiento | undefined> =>
    db
      .selectFrom('movimiento_inventario')
      .select([
        'id',
        'sucursal_id',
        'vendedor_id',
        'cliente_id',
        'tipo',
        'comentario',
        'registrado_en',
      ])
      .select(sql<string>`fecha::text`.as('fecha_texto'))
      .where('id', '=', id)
      .executeTakeFirst();

  const lineas = (id: string) =>
    db
      .selectFrom('movimiento_inventario_linea')
      .select(['presentacion_id', 'sentido', 'piezas'])
      .where('movimiento_id', '=', id)
      .orderBy('sentido', 'desc')
      .execute();

  const buzon = (clave: string) =>
    db
      .selectFrom('sync_operacion')
      .select(['entidad_tabla', 'entidad_id'])
      .where('vendedor_id', '=', vendedorId)
      .where('clave_idempotencia', '=', clave)
      .executeTakeFirst();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    sucursalId = (
      await db
        .insertInto('sucursal')
        .values({ codigo: CODIGO, nombre: 'Prueba movimientos' })
        .onConflict((oc) =>
          oc
            .column('codigo')
            .doUpdateSet({ deleted_at: null, consumo_diario_max: 1 }),
        )
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();
    usuarioId = (
      await db
        .insertInto('usuario')
        .values({
          login: LOGIN_GENERAL,
          nombre: LOGIN_GENERAL,
          password_hash: hash,
          perfil_id: perfilId,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login: LOGIN_GENERAL, password: PASSWORD })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    cookieGeneral = cookies
      .find((c) => c.startsWith('jawa_access='))!
      .split(';')[0];

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor de movimientos',
          password_hash: hash,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const cliente = async (nombre: string, sucursal: string) =>
      (
        await db
          .insertInto('cliente')
          .values({
            nombre,
            domicilio: 'Calle 1',
            telefono: '6640000000',
            tipo: 'cliente',
            lista_precio_id: lista.id,
            sucursal_id: sucursal,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    clienteId = await cliente(`${PREFIJO} Abarrotes`, sucursalId);
    const tj = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'TJ')
      .executeTakeFirstOrThrow();
    // De OTRA sucursal: el alcance del lote lo rechaza.
    clienteAjenoId = await cliente(`${PREFIJO} Ajeno`, tj.id);

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `${PREFIJO} Horchata` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const presentacion = async (volumen: string) =>
      (
        await db
          .insertInto('presentacion')
          .values({ producto_id: productoId, volumen })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    litro = await presentacion('1 L');
    medio = await presentacion('500 ml');

    bearer = (
      (
        await request(app.getHttpServer())
          .post('/auth/app/login')
          .send({ login: LOGIN, password: PASSWORD })
          .expect(200)
      ).body as { tokenAcceso: string }
    ).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    const movimientos = db
      .selectFrom('movimiento_inventario')
      .select('id')
      .where('vendedor_id', '=', vendedorId);
    await db
      .deleteFrom('movimiento_inventario_linea')
      .where('movimiento_id', 'in', movimientos)
      .execute();
    await db
      .deleteFrom('movimiento_inventario')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('producto_id', '=', productoId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', '=', vendedorId)
      .execute();
    await db.deleteFrom('vendedor').where('id', '=', vendedorId).execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioId).execute();
    await db.deleteFrom('sucursal').where('codigo', '=', CODIGO).execute();
    await app.close();
  });

  it('una merma del cliente entra con la clave como id, el dia del sobre y sus lineas', async () => {
    // A las 18:30 de Tijuana del 10 de mayo en UTC ya es el 11: cuenta el 10.
    const op = mermaCliente({
      registrado_en: '2018-05-11T01:30:00.000Z',
      comentario: '  Venían reventadas  ',
    });
    const r = (await push([op])).resultados[0];
    expect(r.estado).toBe('aplicada');

    const fila = await filaMovimiento(op.clave);
    expect(fila).toMatchObject({
      id: op.clave,
      sucursal_id: sucursalId,
      vendedor_id: vendedorId,
      cliente_id: clienteId,
      tipo: 'merma_cliente',
      comentario: 'Venían reventadas',
      fecha_texto: FECHA,
    });
    expect(new Date(fila!.registrado_en).toISOString()).toBe(
      '2018-05-11T01:30:00.000Z',
    );
    expect(await lineas(op.clave)).toEqual([
      { presentacion_id: litro, sentido: 'recibido', piezas: 3 },
      { presentacion_id: medio, sentido: 'entregado', piezas: 2 },
    ]);
    expect(await buzon(op.clave)).toEqual({
      entidad_tabla: 'movimiento_inventario',
      entidad_id: op.clave,
    });
  });

  it('la merma del trayecto y el consumo entran sin cliente', async () => {
    const trayecto = sinCliente('merma_trayecto', 2);
    const consumo = sinCliente('consumo');
    const r = await push([trayecto, consumo]);
    expect(r.resultados.map((x) => x.estado)).toEqual(['aplicada', 'aplicada']);
    expect(await filaMovimiento(trayecto.clave)).toMatchObject({
      tipo: 'merma_trayecto',
      cliente_id: null,
    });
    expect(await filaMovimiento(consumo.clave)).toMatchObject({
      tipo: 'consumo',
      cliente_id: null,
    });
  });

  it('el servidor no revisa el limite de consumo: dos consumos sobre el limite de 1 entran', async () => {
    const r = await push([sinCliente('consumo', 5), sinCliente('consumo', 5)]);
    expect(r.resultados.map((x) => x.estado)).toEqual(['aplicada', 'aplicada']);
  });

  it('reenviar la misma clave es duplicada, con el mismo id_servidor y sin otra fila', async () => {
    const op = sinCliente('merma_trayecto');
    const primero = (await push([op])).resultados[0];
    const segundo = (await push([op])).resultados[0];
    expect(segundo).toMatchObject({
      estado: 'duplicada',
      id_servidor: primero.id_servidor,
    });
    expect(await lineas(op.clave)).toHaveLength(1);
  });

  it.each([
    [
      'una merma del cliente sin cliente_id',
      () => mermaCliente({}, { cliente_id: undefined }),
      /^cliente_id: /,
    ],
    [
      'un consumo con cliente_id',
      () => ({ ...sinCliente('consumo'), cliente_id: clienteId }),
      /^cliente_id: /,
    ],
    [
      'una clave que no es uuid',
      () => mermaCliente({}, { clave: 'movimiento-123' }),
      /^clave: /,
    ],
    // El folio en el sobre lo cubre `despacho-movimiento.spec.ts`: aqui `normalizarOperacion`
    // lo rechazaria antes como `folio-invalido` (el vendedor de ZM no tiene segmento).
  ])('%s es datos-invalidos y no deja fila', async (_caso, armar, motivo) => {
    const op = armar();
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(motivo);
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('Review Focus 3: una merma del cliente solo con lo entregado es datos-invalidos', async () => {
    const op = mermaCliente({
      lineas: [{ presentacion_id: medio, sentido: 'entregado', piezas: 2 }],
    });
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(/^lineas: .*recibido/);
    expect(await filaMovimiento(op.clave)).toBeUndefined();
  });

  it('una presentacion que no existe es datos-invalidos y el rollback no deja ni buzon ni movimiento', async () => {
    const op = mermaCliente({
      lineas: [
        { presentacion_id: randomUUID(), sentido: 'recibido', piezas: 1 },
      ],
    });
    const r = (await push([op])).resultados[0];
    expect(r).toMatchObject({ estado: 'rechazada', codigo: 'datos-invalidos' });
    expect(r.motivo).toMatch(/^lineas: /);
    expect(await filaMovimiento(op.clave)).toBeUndefined();
    expect(await buzon(op.clave)).toBeUndefined();
  });

  it('un cliente de otra sucursal es cliente-fuera-de-alcance', async () => {
    const op = mermaCliente({}, { cliente_id: clienteAjenoId });
    expect((await push([op])).resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'cliente-fuera-de-alcance',
    });
  });

  it('un id ocupado por otro movimiento es movimiento-id-ocupado con motivo neutro', async () => {
    const ocupado = randomUUID();
    await db
      .insertInto('movimiento_inventario')
      .values({
        id: ocupado,
        sucursal_id: sucursalId,
        vendedor_id: vendedorId,
        cliente_id: null,
        tipo: 'consumo',
        fecha: FECHA,
        registrado_en: new Date(),
      })
      .execute();
    const r = (await push([mermaCliente({}, { clave: ocupado })]))
      .resultados[0];
    expect(r).toMatchObject({
      estado: 'rechazada',
      codigo: 'movimiento-id-ocupado',
    });
    expect(r.motivo).not.toContain(clienteId);
    expect(await buzon(ocupado)).toBeUndefined();
  });

  it('Review Focus 4: alta y merma en el MISMO lote: la merma cae por alcance y entra en el siguiente', async () => {
    const alta = altaProspecto();
    const op = mermaCliente({}, { cliente_id: alta.clave });
    const r = await push([alta, op]);
    expect(r.resultados[0].estado).toBe('aplicada');
    expect(r.resultados[1]).toMatchObject({
      estado: 'rechazada',
      codigo: 'cliente-fuera-de-alcance',
    });
    // La tablet la reenvia con la misma clave en el siguiente lote: no se pierde.
    expect((await push([op])).resultados[0].estado).toBe('aplicada');
    expect(await filaMovimiento(op.clave)).toMatchObject({
      cliente_id: alta.clave,
    });
  });

  describe('consumo_diario_max (D4)', () => {
    it('Review Focus 5: cambiar el limite en el portal baja en el pull incremental', async () => {
      const completo = await pull();
      expect(completo.catalogos.vendedores).toEqual([
        expect.objectContaining({ id: vendedorId, consumo_diario_max: 1 }),
      ]);
      const antes = completo.servidor_en;
      // Sin cambios, el vendedor no vuelve a bajar.
      expect((await pull(antes)).catalogos.vendedores).toEqual([]);

      const editada = await patchSucursal({ consumoDiarioMax: 3 }).expect(200);
      expect(
        (editada.body as { consumoDiarioMax: number }).consumoDiarioMax,
      ).toBe(3);
      // El vendedor no cambio, pero su sucursal si: baja con el limite nuevo.
      expect((await pull(antes)).catalogos.vendedores).toEqual([
        expect.objectContaining({ id: vendedorId, consumo_diario_max: 3 }),
      ]);
    });

    it.each([[100], [-1], [1.5], ['2']])(
      'consumoDiarioMax %j es 400',
      async (valor) => {
        await patchSucursal({ consumoDiarioMax: valor }).expect(400);
      },
    );

    it('0 apaga el consumo propio y tambien baja', async () => {
      const antes = (await pull()).servidor_en;
      await patchSucursal({ consumoDiarioMax: 0 }).expect(200);
      expect((await pull(antes)).catalogos.vendedores).toEqual([
        expect.objectContaining({ id: vendedorId, consumo_diario_max: 0 }),
      ]);
    });
  });
});
