import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
import type { Promocion } from './../src/modules/cartera-clientes/promociones.repository';

/**
 * Promociones por regla desde el portal (T-74), de punta a punta: permiso,
 * alcance por sucursal, validacion con mensaje, la frase y el desplazamiento
 * de una general por una propia del cliente (D5).
 *
 * Usa los productos y presentaciones de la semilla base; lo que crea (clientes,
 * promociones, notas) se borra en `afterAll` por id.
 */
const SUFIJO = `${Date.now()}-${process.pid}`;
const PASSWORD = 'contrasena-de-prueba';
const LOGIN_GENERAL = `e2e-promo-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-promo-tj-${SUFIJO}`;
const LOGIN_MEXICALI = `e2e-promo-mx-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-promo-sin-${SUFIJO}`;
const UUID_AUSENTE = '00000000-0000-4000-8000-000000000000';

type Cuerpo = Record<string, unknown>;

describe('Promociones del portal (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let tjId: string;
  let mxId: string;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  const promocionIds: string[] = [];
  const notaIds: string[] = [];
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieMexicali: string;
  let cookieSinPermiso: string;
  let productoA: { id: string; nombre: string };
  let productoB: { id: string; nombre: string };
  let presentacionA: { id: string; nombre: string };
  let clientes = 0;
  let folios = 0;

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  /** `Administrador General` trae todos los permisos; `Auxiliar Administrativo` esta vacio. */
  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ) => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({
        login,
        nombre: login,
        password_hash: hash,
        perfil_id: perfilId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
  };

  const sembrarCliente = async (
    sucursalId: string,
  ): Promise<{ id: string; nombre: string }> => {
    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    const nombre = `Promo portal ${++clientes} ${SUFIJO}`;
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre,
        domicilio: 'Calle 1',
        telefono: '6640000000',
        tipo: 'cliente',
        lista_precio_id: lista.id,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return { id, nombre };
  };

  /** Regla base: por cada 10 del producto A, 1 del mismo, se repite. */
  const regla = (extra: Cuerpo = {}): Cuerpo => ({
    audiencia: 'todos',
    compraTipo: 'producto',
    compraProductoId: productoA.id,
    compraCantidad: 10,
    regaloTipo: 'mismo',
    regaloCantidad: 1,
    seRepite: true,
    ...extra,
  });

  const crear = async (cookie: string, cuerpo: Cuerpo) => {
    const res = await request(app.getHttpServer())
      .post('/promociones')
      .set('Cookie', cookie)
      .send(cuerpo);
    if (res.status === 201) {
      for (const p of res.body as Promocion[]) promocionIds.push(p.id);
    }
    return res;
  };

  const listar = (cookie: string, query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(`/promociones?${new URLSearchParams(query).toString()}`)
      .set('Cookie', cookie);

  const editar = (cookie: string, id: string, cuerpo: Cuerpo) =>
    request(app.getHttpServer())
      .patch(`/promociones/${id}`)
      .set('Cookie', cookie)
      .send(cuerpo);

  /** El cuerpo de un PATCH que deja la regla base y cambia lo que se pida. */
  const cuerpoEditar = (extra: Cuerpo = {}): Cuerpo => {
    const { audiencia: _audiencia, ...resto } = regla();
    void _audiencia;
    return { ...resto, activo: true, ...extra };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await iniciarEnLocal(app);
    db = app.get<Database>(DB_CONNECTION);

    tjId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'TJ')
        .executeTakeFirstOrThrow()
    ).id;
    mxId = (
      await db
        .selectFrom('sucursal')
        .select('id')
        .where('codigo', '=', 'MX')
        .executeTakeFirstOrThrow()
    ).id;

    const productos = await db
      .selectFrom('producto')
      .select(['id', 'nombre'])
      .where('deleted_at', 'is', null)
      .orderBy('nombre')
      .limit(2)
      .execute();
    [productoA, productoB] = productos;
    const pres = await db
      .selectFrom('presentacion')
      .select(['id', 'volumen'])
      .where('producto_id', '=', productoA.id)
      .where('deleted_at', 'is', null)
      .orderBy('volumen')
      .limit(1)
      .executeTakeFirstOrThrow();
    presentacionA = {
      id: pres.id,
      nombre: `${productoA.nombre} ${pres.volumen}`,
    };

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', tjId);
    await crearUsuario(LOGIN_MEXICALI, 'Administrador General', mxId);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);
    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieMexicali = await iniciarSesion(LOGIN_MEXICALI);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    if (notaIds.length > 0) {
      await db
        .deleteFrom('venta_nota_promocion')
        .where('venta_nota_id', 'in', notaIds)
        .execute();
      await db.deleteFrom('venta_nota').where('id', 'in', notaIds).execute();
    }
    if (promocionIds.length > 0) {
      await db
        .deleteFrom('promocion')
        .where('id', 'in', promocionIds)
        .execute();
    }
    if (clienteIds.length > 0) {
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', 'in', usuarioIds)
      .execute();
    await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    await app.close();
  });

  it('sin promocion.gestionar todo es 403, lectura incluida', async () => {
    await listar(cookieSinPermiso, { sucursal: 'TJ' }).expect(403);
    await crear(cookieSinPermiso, regla({ sucursalId: tjId })).then((r) =>
      expect(r.status).toBe(403),
    );
    await editar(cookieSinPermiso, UUID_AUSENTE, cuerpoEditar()).expect(403);
  });

  it("un General crea con 'todas': una promocion por sucursal activa, con su frase", async () => {
    const res = await crear(cookieGeneral, regla({ sucursalId: 'todas' }));
    expect(res.status).toBe(201);
    const creadas = res.body as Promocion[];
    // Otras suites (sucursales) crean y borran sucursales en paralelo: se
    // comprueba lo que no depende de ellas (TJ y MX, una fila cada una) y las
    // filas de sucursales ajenas se borran enseguida para no atorar su limpieza.
    const codigos = creadas.map((p) => p.sucursalCodigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(codigos).toEqual(expect.arrayContaining(['TJ', 'MX']));
    await db
      .deleteFrom('promocion')
      .where(
        'id',
        'in',
        creadas.map((p) => p.id),
      )
      .where('sucursal_id', 'not in', [tjId, mxId])
      .execute();
    for (const p of creadas) {
      expect(p.texto).toBe(
        `Por cada 10 ${productoA.nombre}, 1 ${productoA.nombre} gratis`,
      );
      expect(p.activo).toBe(true);
    }
  });

  it("un usuario de Tijuana con 'todas' crea solo en TJ", async () => {
    const res = await crear(cookieTijuana, regla({ sucursalId: 'todas' }));
    expect(res.status).toBe(201);
    const creadas = res.body as Promocion[];
    expect(creadas).toHaveLength(1);
    expect(creadas[0].sucursalCodigo).toBe('TJ');
  });

  it('una promocion de cliente: 404 si es de otra sucursal, 201 si es de la suya', async () => {
    const deMx = await sembrarCliente(mxId);
    const deTj = await sembrarCliente(tjId);
    const ajeno = await crear(
      cookieTijuana,
      regla({ audiencia: 'cliente', clienteId: deMx.id }),
    );
    expect(ajeno.status).toBe(404);
    expect(ajeno.body).toMatchObject({ message: 'No existe ese cliente.' });

    const propio = await crear(
      cookieTijuana,
      regla({ audiencia: 'cliente', clienteId: deTj.id }),
    );
    expect(propio.status).toBe(201);
    expect((propio.body as Promocion[])[0]).toMatchObject({
      sucursalCodigo: 'TJ',
      clienteNombre: deTj.nombre,
      audiencia: 'cliente',
    });
  });

  it('una regla incoherente es 400 con el mensaje de la oficina', async () => {
    const mensaje = (r: request.Response) =>
      (r.body as { message: string }).message;

    const delMismoConCualquiera = await crear(
      cookieGeneral,
      regla({
        sucursalId: tjId,
        compraTipo: 'cualquiera',
        compraProductoId: undefined,
      }),
    );
    expect(delMismoConCualquiera.status).toBe(400);
    expect(mensaje(delMismoConCualquiera)).toBe(
      'Si la compra es de cualquier producto, el regalo tiene que ser un producto o una presentación concretos.',
    );

    const compraCero = await crear(
      cookieGeneral,
      regla({ sucursalId: tjId, compraCantidad: 0 }),
    );
    expect(compraCero.status).toBe(400);
    expect(mensaje(compraCero)).toBe(
      'La cantidad de compra debe ser al menos 1; solo la promoción de prospectos puede regalar sin compra.',
    );

    const sinCliente = await crear(
      cookieGeneral,
      regla({ sucursalId: tjId, audiencia: 'cliente' }),
    );
    expect(sinCliente.status).toBe(400);
    expect(mensaje(sinCliente)).toBe('Elige el cliente de la promoción.');
  });

  it('la bienvenida al prospecto regala sin compra', async () => {
    const res = await crear(cookieGeneral, {
      sucursalId: tjId,
      audiencia: 'prospecto',
      compraTipo: 'cualquiera',
      compraCantidad: 0,
      regaloTipo: 'presentacion',
      regaloPresentacionId: presentacionA.id,
      regaloCantidad: 2,
      seRepite: false,
    });
    expect(res.status).toBe(201);
    expect((res.body as Promocion[])[0].texto).toBe(
      `Bienvenida al prospecto: 2 ${presentacionA.nombre} gratis en su primera venta`,
    );
  });

  it('un producto que no existe es 404 con mensaje', async () => {
    const res = await crear(
      cookieGeneral,
      regla({ sucursalId: tjId, compraProductoId: UUID_AUSENTE }),
    );
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      message: 'No existe el producto que se compra.',
    });
  });

  it('GET ?sucursal=TJ lista las generales de TJ (activas e inactivas), no las de MX', async () => {
    const enTj = (await crear(cookieGeneral, regla({ sucursalId: tjId })))
      .body as Promocion[];
    const enMx = (await crear(cookieGeneral, regla({ sucursalId: mxId })))
      .body as Promocion[];
    const inactiva = (
      await crear(cookieGeneral, regla({ sucursalId: tjId, compraCantidad: 7 }))
    ).body as Promocion[];
    await editar(
      cookieGeneral,
      inactiva[0].id,
      cuerpoEditar({ compraCantidad: 7, activo: false }),
    ).expect(200);

    const res = await listar(cookieGeneral, { sucursal: 'TJ' }).expect(200);
    const lista = res.body as Promocion[];
    expect(lista.every((p) => p.sucursalCodigo === 'TJ')).toBe(true);
    expect(lista.every((p) => p.audiencia !== 'cliente')).toBe(true);
    expect(lista.map((p) => p.id)).toEqual(
      expect.arrayContaining([enTj[0].id, inactiva[0].id]),
    );
    expect(lista.map((p) => p.id)).not.toContain(enMx[0].id);
    expect(lista.find((p) => p.id === inactiva[0].id)?.activo).toBe(false);

    // Un General sin sucursal no tiene que adivinar: se le pide una.
    await listar(cookieGeneral).expect(400);
  });

  it('GET ?clienteId= marca como desplazadas las generales que comparten producto con una propia', async () => {
    const cliente = await sembrarCliente(tjId);
    const propia = (
      await crear(
        cookieTijuana,
        regla({ audiencia: 'cliente', clienteId: cliente.id }),
      )
    ).body as Promocion[];
    const sobreA = (await crear(cookieTijuana, regla())).body as Promocion[];
    const cualquiera = (
      await crear(
        cookieTijuana,
        regla({
          compraTipo: 'cualquiera',
          compraProductoId: undefined,
          compraCantidad: 20,
          regaloTipo: 'producto',
          regaloProductoId: productoB.id,
        }),
      )
    ).body as Promocion[];
    const sobreB = (
      await crear(
        cookieTijuana,
        regla({ compraProductoId: productoB.id, compraCantidad: 12 }),
      )
    ).body as Promocion[];

    const res = await listar(cookieTijuana, { clienteId: cliente.id }).expect(
      200,
    );
    const lista = res.body as Promocion[];
    const por = (id: string) => lista.find((p) => p.id === id);
    expect(por(propia[0].id)).toBeDefined();
    expect(por(sobreA[0].id)?.desplazada).toBe(true);
    expect(por(cualquiera[0].id)?.desplazada).toBe(true);
    expect(por(sobreB[0].id)?.desplazada).toBe(false);
    // Solo la propia del cliente y las de `todos` de su sucursal.
    expect(
      lista.every(
        (p) =>
          p.sucursalCodigo === 'TJ' &&
          (p.audiencia === 'todos' || p.clienteId === cliente.id),
      ),
    ).toBe(true);
  });

  it('PATCH cambia la regla y desactiva; fuera de alcance es 403 y un id ausente 404', async () => {
    const creada = (await crear(cookieTijuana, regla())).body as Promocion[];
    const id = creada[0].id;

    const res = await editar(
      cookieTijuana,
      id,
      cuerpoEditar({ compraCantidad: 6, activo: false }),
    ).expect(200);
    const editada = res.body as Promocion;
    expect(editada.activo).toBe(false);
    expect(editada.compraCantidad).toBe(6);
    expect(editada.texto).toBe(
      `Por cada 6 ${productoA.nombre}, 1 ${productoA.nombre} gratis`,
    );

    await editar(cookieMexicali, id, cuerpoEditar()).expect(403);
    await editar(cookieGeneral, UUID_AUSENTE, cuerpoEditar()).expect(404);
  });

  it('desactivar no borra la fila ni toca las notas que la usaron', async () => {
    const creada = (await crear(cookieTijuana, regla())).body as Promocion[];
    const id = creada[0].id;
    const cliente = await sembrarCliente(tjId);
    const { id: notaId } = await db
      .insertInto('venta_nota')
      .values({
        folio: `ZZPR${String(++folios).padStart(3, '0')}${SUFIJO}`.slice(0, 30),
        fecha: new Date(),
        cliente_id: cliente.id,
        vendedor_id: null,
        monto_total: 0,
        num_nota: null,
        contado_credito: 'credito',
        semana: 1,
        mes: 1,
        status: 'pendiente',
        sucursal_id: tjId,
        origen: 'portal',
        capturo_usuario_id: usuarioIds[0],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    notaIds.push(notaId);
    await db
      .insertInto('venta_nota_promocion')
      .values({
        venta_nota_id: notaId,
        promocion_id: id,
        presentacion_id: presentacionA.id,
        cantidad: 1,
        promocion_texto: creada[0].texto,
      })
      .execute();

    await editar(cookieTijuana, id, cuerpoEditar({ activo: false })).expect(
      200,
    );

    const fila = await db
      .selectFrom('promocion')
      .select(['activo', 'deleted_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(fila.activo).toBe(false);
    expect(fila.deleted_at).toBeNull();
    const nota = await db
      .selectFrom('venta_nota_promocion')
      .select(['promocion_id', 'promocion_texto', 'cantidad'])
      .where('venta_nota_id', '=', notaId)
      .execute();
    expect(nota).toEqual([
      {
        promocion_id: id,
        promocion_texto: creada[0].texto,
        cantidad: 1,
      },
    ]);
  });

  it('GET ?clienteId= de un cliente de otra sucursal es 404, no 403', async () => {
    const deMx = await sembrarCliente(mxId);
    const res = await listar(cookieTijuana, { clienteId: deMx.id });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: 'No existe ese cliente.' });
    await listar(cookieTijuana, { clienteId: 'no-es-uuid' }).expect(400);
  });
});
