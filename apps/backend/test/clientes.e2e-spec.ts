import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';

interface ClienteResumenRespuesta {
  id: string;
  nombre: string;
  telefono: string;
  tipo: 'cliente' | 'prospecto';
  tipoNegocio: string | null;
  sucursalCodigo: string;
}

interface ClienteDetalleRespuesta extends ClienteResumenRespuesta {
  domicilio: string;
  encargado: string | null;
  factura: boolean;
  tipoNegocioId: string | null;
  listaPrecioId: string;
  pctComision: number | null;
  promocion: 'ninguna' | '10+1' | '20+1';
  plazoCreditoDias: number | null;
  lat: number | null;
  lng: number | null;
  comentarios: string | null;
  sucursalId: string;
  overridesPrecio: {
    presentacionId: string;
    precio: number;
    vigenteDesde: string;
  }[];
  productosPromocion: string[];
}

// El PID va pegado al timestamp porque Jest corre archivos en paralelo, en
// procesos distintos: dos suites que arrancan en el mismo milisegundo
// generarian el mismo PREFIJO, y el afterAll de una borraria filas que la
// otra todavia necesita (foreign key violation cruzada entre suites).
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_GENERAL = `e2e-cli-gen-${SUFIJO}`;
const LOGIN_TIJUANA = `e2e-cli-tj-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-cli-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-e2e-${SUFIJO}`;

describe('Clientes (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  const clienteIds: string[] = [];
  let idTijuana: string;
  let idMexicali: string;
  let listaId: string;
  let cookieGeneral: string;
  let cookieTijuana: string;
  let cookieSinPermiso: string;

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

  const crearUsuario = async (
    login: string,
    perfil: string,
    sucursalId: string | null,
  ): Promise<void> => {
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

  /** Inserta un cliente por debajo de la API, para preparar escenarios de lectura. */
  const sembrarCliente = async (
    nombre: string,
    sucursalId: string,
    tipo: 'cliente' | 'prospecto' = 'cliente',
  ): Promise<string> => {
    const { id } = await db
      .insertInto('cliente')
      .values({
        nombre,
        domicilio: 'Domicilio de prueba',
        telefono: '000',
        factura: false,
        tipo,
        lista_precio_id: listaId,
        sucursal_id: sucursalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    clienteIds.push(id);
    return id;
  };

  /** Producto con una presentacion, para las pruebas de override y promocion. */
  const sembrarProducto = async (
    nombre: string,
  ): Promise<{ productoId: string; presentacionId: string }> => {
    const producto = await db
      .insertInto('producto')
      .values({ nombre })
      .returning('id')
      .executeTakeFirstOrThrow();
    const presentacion = await db
      .insertInto('presentacion')
      .values({ producto_id: producto.id, volumen: '500 ml' })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { productoId: producto.id, presentacionId: presentacion.id };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    const tj = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'TJ')
      .executeTakeFirstOrThrow();
    idTijuana = tj.id;

    const mx = await db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'MX')
      .executeTakeFirstOrThrow();
    idMexicali = mx.id;

    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();
    listaId = lista.id;

    await crearUsuario(LOGIN_GENERAL, 'Administrador General', null);
    await crearUsuario(LOGIN_TIJUANA, 'Administrador General', idTijuana);
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo', null);

    cookieGeneral = await iniciarSesion(LOGIN_GENERAL);
    cookieTijuana = await iniciarSesion(LOGIN_TIJUANA);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    if (clienteIds.length > 0) {
      await db
        .deleteFrom('cliente_promocion_producto')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db
        .deleteFrom('cliente_precio')
        .where('cliente_id', 'in', clienteIds)
        .execute();
      await db.deleteFrom('cliente').where('id', 'in', clienteIds).execute();
    }
    const productos = await db
      .selectFrom('producto')
      .select('id')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    const productoIds = productos.map((p) => p.id);
    if (productoIds.length > 0) {
      await db
        .deleteFrom('presentacion')
        .where('producto_id', 'in', productoIds)
        .execute();
      await db.deleteFrom('producto').where('id', 'in', productoIds).execute();
    }
    await db
      .deleteFrom('tipo_negocio')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  describe('GET /clientes', () => {
    it('lista los clientes con su tipo de negocio y codigo de sucursal', async () => {
      await sembrarCliente(`${PREFIJO} Listar TJ`, idTijuana);

      const res = await request(app.getHttpServer())
        .get('/clientes')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const clientes = res.body as ClienteResumenRespuesta[];
      const propio = clientes.find((c) => c.nombre === `${PREFIJO} Listar TJ`);
      expect(propio).toBeDefined();
      expect(propio?.sucursalCodigo).toBe('TJ');
      expect(propio?.tipo).toBe('cliente');
      expect(propio).not.toHaveProperty('deleted_at');
    });

    it('un usuario atado a TJ no ve los clientes de MX', async () => {
      await sembrarCliente(`${PREFIJO} Solo MX`, idMexicali);

      const res = await request(app.getHttpServer())
        .get('/clientes')
        .set('Cookie', cookieTijuana)
        .expect(200);

      const nombres = (res.body as ClienteResumenRespuesta[]).map(
        (c) => c.nombre,
      );
      expect(nombres).not.toContain(`${PREFIJO} Solo MX`);
    });

    it('un usuario atado que pide OTRA sucursal recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/clientes?sucursal=MX')
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('filtra por tipo=prospecto', async () => {
      await sembrarCliente(`${PREFIJO} Prospecto`, idTijuana, 'prospecto');

      const res = await request(app.getHttpServer())
        .get('/clientes?tipo=prospecto')
        .set('Cookie', cookieGeneral)
        .expect(200);

      const clientes = res.body as ClienteResumenRespuesta[];
      expect(clientes.every((c) => c.tipo === 'prospecto')).toBe(true);
      expect(clientes.some((c) => c.nombre === `${PREFIJO} Prospecto`)).toBe(
        true,
      );
    });

    it('deja listar aunque el usuario no tenga cliente.gestionar', async () => {
      await request(app.getHttpServer())
        .get('/clientes')
        .set('Cookie', cookieSinPermiso)
        .expect(200);
    });

    it('rechaza a quien no tiene sesion', async () => {
      await request(app.getHttpServer()).get('/clientes').expect(401);
    });
  });

  describe('GET /clientes/:id', () => {
    it('devuelve el detalle completo, con arreglos vacios si no hay overrides ni promocion', async () => {
      const id = await sembrarCliente(`${PREFIJO} Detalle`, idTijuana);

      const res = await request(app.getHttpServer())
        .get(`/clientes/${id}`)
        .set('Cookie', cookieGeneral)
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.nombre).toBe(`${PREFIJO} Detalle`);
      expect(cliente.sucursalCodigo).toBe('TJ');
      expect(cliente.overridesPrecio).toEqual([]);
      expect(cliente.productosPromocion).toEqual([]);
      expect(cliente.promocion).toBe('ninguna');
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .get('/clientes/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieGeneral)
        .expect(404);
    });

    it('un usuario atado a TJ no puede leer el detalle de un cliente de MX', async () => {
      const id = await sembrarCliente(`${PREFIJO} Detalle MX`, idMexicali);

      await request(app.getHttpServer())
        .get(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('responde 400 para un id mal formado', async () => {
      await request(app.getHttpServer())
        .get('/clientes/no-es-un-uuid')
        .set('Cookie', cookieGeneral)
        .expect(400);
    });
  });

  describe('POST /clientes', () => {
    const datosMinimos = (extra: Record<string, unknown> = {}) => ({
      nombre: `${PREFIJO} Alta`,
      domicilio: 'Domicilio',
      telefono: '000',
      factura: false,
      tipo: 'cliente',
      listaPrecioId: listaId,
      promocion: 'ninguna',
      productosPromocion: [],
      overridesPrecio: [],
      vigenteDesde: '2026-08-31',
      ...extra,
    });

    it('da de alta un cliente completo con override y promocion', async () => {
      const { productoId, presentacionId } = await sembrarProducto(
        `${PREFIJO} Producto Alta`,
      );

      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(
          datosMinimos({
            nombre: `${PREFIJO} Completo`,
            promocion: '10+1',
            productosPromocion: [productoId],
            overridesPrecio: [{ presentacionId, precio: 18.5 }],
          }),
        )
        .expect(201);

      const cliente = res.body as ClienteDetalleRespuesta;
      clienteIds.push(cliente.id);
      expect(cliente.sucursalCodigo).toBe('TJ');
      expect(cliente.promocion).toBe('10+1');
      expect(cliente.productosPromocion).toEqual([productoId]);
      expect(cliente.overridesPrecio).toEqual([
        { presentacionId, precio: 18.5, vigenteDesde: '2026-08-31' },
      ]);
    });

    it('promocion "ninguna" ignora productosPromocion aunque se manden ids (D4)', async () => {
      const { productoId } = await sembrarProducto(
        `${PREFIJO} Producto Ignorado`,
      );

      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(datosMinimos({ productosPromocion: [productoId] }))
        .expect(201);

      const cliente = res.body as ClienteDetalleRespuesta;
      clienteIds.push(cliente.id);
      expect(cliente.productosPromocion).toEqual([]);
    });

    it('un usuario atado a TJ no puede mandar sucursalId de MX: se ignora, no 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(datosMinimos({ sucursalId: idMexicali }))
        .expect(201);

      const cliente = res.body as ClienteDetalleRespuesta;
      clienteIds.push(cliente.id);
      expect(cliente.sucursalCodigo).toBe('TJ');
    });

    it('un usuario General sin sucursalId recibe 400', async () => {
      await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieGeneral)
        .send(datosMinimos())
        .expect(400);
    });

    it('un usuario General con sucursalId da de alta en esa sucursal', async () => {
      const res = await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieGeneral)
        .send(datosMinimos({ sucursalId: idMexicali }))
        .expect(201);

      const cliente = res.body as ClienteDetalleRespuesta;
      clienteIds.push(cliente.id);
      expect(cliente.sucursalCodigo).toBe('MX');
    });

    it('responde 404 si listaPrecioId no existe', async () => {
      await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(
          datosMinimos({
            listaPrecioId: '00000000-0000-0000-0000-000000000000',
          }),
        )
        .expect(404);
    });

    it('responde 400 si falta un campo obligatorio', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { nombre: _nombre, ...sinNombre } = datosMinimos();
      await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieTijuana)
        .send(sinNombre)
        .expect(400);
    });

    it('rechaza sin cliente.gestionar con 403', async () => {
      await request(app.getHttpServer())
        .post('/clientes')
        .set('Cookie', cookieSinPermiso)
        .send(datosMinimos())
        .expect(403);
    });
  });

  describe('PATCH /clientes/:id', () => {
    const cambios = (extra: Record<string, unknown> = {}) => ({
      nombre: `${PREFIJO} Editado`,
      domicilio: 'Domicilio editado',
      telefono: '111',
      factura: true,
      listaPrecioId: listaId,
      promocion: 'ninguna',
      productosPromocion: [],
      overridesPrecio: [],
      vigenteDesde: '2026-08-31',
      ...extra,
    });

    it('edita los datos base de un cliente', async () => {
      const id = await sembrarCliente(`${PREFIJO} Editar`, idTijuana);

      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios())
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.nombre).toBe(`${PREFIJO} Editado`);
      expect(cliente.telefono).toBe('111');
      expect(cliente.factura).toBe(true);
      expect(cliente.sucursalCodigo).toBe('TJ');
    });

    it('corrige el mismo override el mismo dia en vez de duplicarlo', async () => {
      const id = await sembrarCliente(`${PREFIJO} Override`, idTijuana);
      const { presentacionId } = await sembrarProducto(
        `${PREFIJO} Producto Override`,
      );

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: 15 }] }))
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: 16 }] }))
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.overridesPrecio).toEqual([
        { presentacionId, precio: 16, vigenteDesde: '2026-08-31' },
      ]);

      const filas = await db
        .selectFrom('cliente_precio')
        .select('id')
        .where('cliente_id', '=', id)
        .where('presentacion_id', '=', presentacionId)
        .execute();
      expect(filas).toHaveLength(1);
    });

    it('precio: null quita el override del dia (D5)', async () => {
      const id = await sembrarCliente(`${PREFIJO} Quitar Override`, idTijuana);
      const { presentacionId } = await sembrarProducto(
        `${PREFIJO} Producto Quitar`,
      );

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: 15 }] }))
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: null }] }))
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.overridesPrecio).toEqual([]);
    });

    it('quitar un override guardado un dia anterior tambien lo quita', async () => {
      const id = await sembrarCliente(
        `${PREFIJO} Override Dia Anterior`,
        idTijuana,
      );
      const { presentacionId } = await sembrarProducto(
        `${PREFIJO} Producto Override Dia Anterior`,
      );

      // Simula un override que se guardo hace varios dias: se inserta
      // directo en la base (no via la API) con `vigente_desde` en el
      // pasado, para que `PATCH` no encuentre ninguna fila fechada HOY.
      await db
        .insertInto('cliente_precio')
        .values({
          cliente_id: id,
          presentacion_id: presentacionId,
          precio: '15',
          vigente_desde: '2026-08-20',
        })
        .execute();

      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: null }] }))
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.overridesPrecio).toEqual([]);

      // Prueba que no es solo el PATCH devolviendo un eco optimista: una
      // lectura aparte confirma que la fila vieja de verdad se dio de baja.
      const detalle = await request(app.getHttpServer())
        .get(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(200);
      expect((detalle.body as ClienteDetalleRespuesta).overridesPrecio).toEqual(
        [],
      );
    });

    it('quitar y volver a agregar el mismo producto de promocion no revienta con 23505', async () => {
      const id = await sembrarCliente(`${PREFIJO} Promo Vuelta`, idTijuana);
      const { productoId } = await sembrarProducto(
        `${PREFIJO} Producto Vuelta`,
      );

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ promocion: '10+1', productosPromocion: [productoId] }))
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ promocion: 'ninguna', productosPromocion: [] }))
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ promocion: '20+1', productosPromocion: [productoId] }))
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.productosPromocion).toEqual([productoId]);
    });

    it('quitar y volver a agregar el mismo override el mismo dia revive la fila, no la deja invisible', async () => {
      const id = await sembrarCliente(`${PREFIJO} Override Vuelta`, idTijuana);
      const { presentacionId } = await sembrarProducto(
        `${PREFIJO} Producto Override Vuelta`,
      );

      // 1. Fija un override hoy.
      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: 15 }] }))
        .expect(200);

      // 2. Lo quita el mismo dia (D5): la fila queda dada de baja.
      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: null }] }))
        .expect(200);

      // 3. Lo vuelve a fijar el mismo dia: el ON CONFLICT de
      // uq_cliente_precio_vigencia cae sobre la MISMA fila dada de baja en
      // el paso 2 (mismo cliente_id, presentacion_id, vigente_desde). Si el
      // upsert no resetea `deleted_at`, el precio nuevo queda invisible.
      const res = await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios({ overridesPrecio: [{ presentacionId, precio: 17 }] }))
        .expect(200);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.overridesPrecio).toEqual([
        { presentacionId, precio: 17, vigenteDesde: '2026-08-31' },
      ]);

      const detalle = await request(app.getHttpServer())
        .get(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(200);
      expect((detalle.body as ClienteDetalleRespuesta).overridesPrecio).toEqual(
        [{ presentacionId, precio: 17, vigenteDesde: '2026-08-31' }],
      );

      const filas = await db
        .selectFrom('cliente_precio')
        .select('id')
        .where('cliente_id', '=', id)
        .where('presentacion_id', '=', presentacionId)
        .execute();
      expect(filas).toHaveLength(1);
    });

    it('un usuario atado a TJ no puede editar un cliente de MX', async () => {
      const id = await sembrarCliente(`${PREFIJO} Editar MX`, idMexicali);

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .send(cambios())
        .expect(403);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .patch('/clientes/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieTijuana)
        .send(cambios())
        .expect(404);
    });

    it('rechaza sin cliente.gestionar con 403', async () => {
      const id = await sembrarCliente(
        `${PREFIJO} Sin Permiso Editar`,
        idTijuana,
      );

      await request(app.getHttpServer())
        .patch(`/clientes/${id}`)
        .set('Cookie', cookieSinPermiso)
        .send(cambios())
        .expect(403);
    });
  });

  describe('DELETE /clientes/:id', () => {
    it('da de baja logica: desaparece del listado pero sigue en la base', async () => {
      const id = await sembrarCliente(`${PREFIJO} Baja`, idTijuana);

      await request(app.getHttpServer())
        .delete(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/clientes')
        .set('Cookie', cookieTijuana)
        .expect(200);
      const nombres = (res.body as ClienteResumenRespuesta[]).map(
        (c) => c.nombre,
      );
      expect(nombres).not.toContain(`${PREFIJO} Baja`);

      const fila = await db
        .selectFrom('cliente')
        .select('deleted_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(fila.deleted_at).not.toBeNull();
    });

    it('un usuario atado a TJ no puede dar de baja un cliente de MX', async () => {
      const id = await sembrarCliente(`${PREFIJO} Baja MX`, idMexicali);

      await request(app.getHttpServer())
        .delete(`/clientes/${id}`)
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .delete('/clientes/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieTijuana)
        .expect(404);
    });

    it('rechaza sin cliente.gestionar con 403', async () => {
      const id = await sembrarCliente(`${PREFIJO} Sin Permiso Baja`, idTijuana);

      await request(app.getHttpServer())
        .delete(`/clientes/${id}`)
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });
  });

  describe('POST /clientes/:id/convertir-a-cliente', () => {
    it('convierte un prospecto en cliente', async () => {
      const id = await sembrarCliente(
        `${PREFIJO} Convertir`,
        idTijuana,
        'prospecto',
      );

      const res = await request(app.getHttpServer())
        .post(`/clientes/${id}/convertir-a-cliente`)
        .set('Cookie', cookieTijuana)
        .expect(201);

      const cliente = res.body as ClienteDetalleRespuesta;
      expect(cliente.tipo).toBe('cliente');

      const enLista = await request(app.getHttpServer())
        .get('/clientes?tipo=cliente')
        .set('Cookie', cookieTijuana)
        .expect(200);
      const nombres = (enLista.body as ClienteResumenRespuesta[]).map(
        (c) => c.nombre,
      );
      expect(nombres).toContain(`${PREFIJO} Convertir`);
    });

    it('responde 409 si ya es cliente', async () => {
      const id = await sembrarCliente(
        `${PREFIJO} Ya Cliente`,
        idTijuana,
        'cliente',
      );

      await request(app.getHttpServer())
        .post(`/clientes/${id}/convertir-a-cliente`)
        .set('Cookie', cookieTijuana)
        .expect(409);
    });

    it('un usuario atado a TJ no puede convertir un prospecto de MX', async () => {
      const id = await sembrarCliente(
        `${PREFIJO} Convertir MX`,
        idMexicali,
        'prospecto',
      );

      await request(app.getHttpServer())
        .post(`/clientes/${id}/convertir-a-cliente`)
        .set('Cookie', cookieTijuana)
        .expect(403);
    });

    it('responde 404 para un id que no existe', async () => {
      await request(app.getHttpServer())
        .post(
          '/clientes/00000000-0000-0000-0000-000000000000/convertir-a-cliente',
        )
        .set('Cookie', cookieTijuana)
        .expect(404);
    });

    it('rechaza sin cliente.gestionar con 403', async () => {
      const id = await sembrarCliente(
        `${PREFIJO} Sin Permiso Convertir`,
        idTijuana,
        'prospecto',
      );

      await request(app.getHttpServer())
        .post(`/clientes/${id}/convertir-a-cliente`)
        .set('Cookie', cookieSinPermiso)
        .expect(403);
    });
  });
});
