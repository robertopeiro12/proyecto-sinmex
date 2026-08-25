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
import { CONTRATO_ACTUAL } from './../src/modules/sincronizacion/contrato';
import { formarFolio } from './../src/modules/sincronizacion/folio';
import { asignarSegmento } from './../src/modules/sincronizacion/segmento-vendedor';
import type {
  RespuestaPull,
  RespuestaPush,
} from './../src/modules/sincronizacion/contrato';

/**
 * Contrato de sincronizacion (T-07) de punta a punta.
 *
 * Es lo mas valioso que se puede verificar **sin una tablet**: idempotencia del
 * push, push parcial honesto, alcance ajeno, separacion de actores y pull
 * incremental. Nada de esto necesita Android; todo esto se rompe en silencio si
 * no se prueba.
 */

const SUFIJO = Date.now();
const LOGIN = `e2e-sync-${SUFIJO}`;
const LOGIN_AJENO = `e2e-sync-ajeno-${SUFIJO}`;
const LOGIN_PORTAL = `e2e-sync-portal-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';

interface RespuestaError {
  message: string | string[];
  codigo?: string;
}

interface Tokens {
  tokenAcceso: string;
  tokenRefresh: string;
}

describe('Sincronizacion pull/push (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  // Sucursal propia (la primera por codigo: MX) y ajena (TJ), ambas semilla.
  let sucursalId: string;
  let sucursalCodigo: string;
  let sucursalAjenaId: string;
  let sucursalAjenaCodigo: string;

  let vendedorId: string;
  let vendedorAjenoId: string;
  /** El 5o segmento del folio de cada uno. Lo asigna el servidor (T-14). */
  let segmento: string;
  let segmentoAjeno: string;
  let usuarioPortalId: string;

  let clienteId: string;
  let clienteAjenoId: string;
  let productoId: string;
  let presentacionId: string;
  let vehiculoId: string;
  let notaId: string;
  let precioId: string;
  let clientePrecioId: string;

  let bearer: string;

  const entrar = async (login = LOGIN): Promise<Tokens> => {
    const res = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    return res.body as Tokens;
  };

  const pull = (query: Record<string, string | number> = {}) => {
    const params = new URLSearchParams({
      contrato: String(CONTRATO_ACTUAL),
      ...Object.fromEntries(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      ),
    });
    return request(app.getHttpServer())
      .get(`/sync/pull?${params.toString()}`)
      .set('Authorization', `Bearer ${bearer}`);
  };

  const push = (cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, ...cuerpo });

  /** Una operacion valida de jornada, con clave unica por defecto. */
  const operacion = (extra: Record<string, unknown> = {}) => ({
    clave: `op-${SUFIJO}-${Math.random().toString(36).slice(2)}`,
    tipo: 'jornada',
    fecha_operacion: new Date().toISOString().slice(0, 10),
    ocurrido_en: new Date().toISOString(),
    datos: { km_inicial: 120345 },
    ...extra,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    // --- Sucursales: la semilla de T-05 dejo TJ y MX. Se usan las dos, para
    // poder probar de verdad "otra sucursal" y no una inventada.
    const sucursales = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .execute();
    expect(sucursales.length).toBeGreaterThanOrEqual(2);
    sucursalId = sucursales[0].id;
    sucursalCodigo = sucursales[0].codigo;
    sucursalAjenaId = sucursales[1].id;
    sucursalAjenaCodigo = sucursales[1].codigo;

    const passwordHash = await new PasswordService().hashear(PASSWORD);

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor sync',
          password_hash: passwordHash,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    vendedorAjenoId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_AJENO,
          nombre: 'Vendedor de la otra sucursal',
          password_hash: passwordHash,
          sucursal_id: sucursalAjenaId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // --- Segmento del folio (T-14).
    //
    // Se asigna con la misma funcion que usa el alta real, contra lo que ya
    // esta ocupado en la base: el segmento es unico entre vendedores vivos, y
    // una corrida anterior que no limpiara podria tener el suyo tomado.
    const ocupados = new Set(
      (
        await db
          .selectFrom('vendedor')
          .select('folio_segmento')
          .where('folio_segmento', 'is not', null)
          .where('deleted_at', 'is', null)
          .execute()
      ).map((f) => f.folio_segmento as string),
    );

    segmento = asignarSegmento('Vendedor Sync', ocupados) as string;
    ocupados.add(segmento);
    segmentoAjeno = asignarSegmento('Otro Ajeno', ocupados) as string;

    await db
      .updateTable('vendedor')
      .set({ folio_segmento: segmento })
      .where('id', '=', vendedorId)
      .execute();
    await db
      .updateTable('vendedor')
      .set({ folio_segmento: segmentoAjeno })
      .where('id', '=', vendedorAjenoId)
      .execute();

    const perfil = await db
      .selectFrom('perfil')
      .select('id')
      .orderBy('nombre')
      .executeTakeFirstOrThrow();

    usuarioPortalId = (
      await db
        .insertInto('usuario')
        .values({
          login: LOGIN_PORTAL,
          nombre: 'Usuario de portal para el cruce',
          password_hash: passwordHash,
          perfil_id: perfil.id,
          sucursal_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // --- Catalogos
    vehiculoId = (
      await db
        .insertInto('vehiculo')
        .values({ nombre: `Camioneta ${SUFIJO}`, sucursal_id: sucursalId })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    productoId = (
      await db
        .insertInto('producto')
        .values({ nombre: `Jamaica ${SUFIJO}` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    presentacionId = (
      await db
        .insertInto('presentacion')
        .values({ producto_id: productoId, volumen: '1 L' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const lista = await db
      .selectFrom('lista_precio')
      .select('id')
      .where('nombre', '=', 'Lista 1')
      .executeTakeFirstOrThrow();

    // 10.10 a proposito: es el importe que delata una conversion con coma
    // flotante (10.10 * 100 = 1010.0000000000001).
    precioId = (
      await db
        .insertInto('precio')
        .values({
          presentacion_id: presentacionId,
          lista_precio_id: lista.id,
          sucursal_id: sucursalId,
          precio: '10.10',
          vigente_desde: '2026-01-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    clienteId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `Abarrotes sync ${SUFIJO}`,
          domicilio: 'Calle 5 #12',
          telefono: '6641234567',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          pct_comision: '3.50',
          promocion: '10+1',
          plazo_credito_dias: 7,
          lat: '32.514900',
          lng: '-117.038200',
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    clienteAjenoId = (
      await db
        .insertInto('cliente')
        .values({
          nombre: `Cliente de otra sucursal ${SUFIJO}`,
          domicilio: 'Otra calle',
          telefono: '6860000000',
          tipo: 'cliente',
          lista_precio_id: lista.id,
          sucursal_id: sucursalAjenaId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Override especial de ese cliente: debe ganarle a la lista.
    clientePrecioId = (
      await db
        .insertInto('cliente_precio')
        .values({
          cliente_id: clienteId,
          presentacion_id: presentacionId,
          precio: '8.00',
          vigente_desde: '2026-02-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // --- Una nota pendiente por cobrar, con un abono parcial.
    notaId = (
      await db
        .insertInto('venta_nota')
        .values({
          folio: `E2E${SUFIJO}`.slice(0, 20),
          fecha: '2026-08-01',
          cliente_id: clienteId,
          vendedor_id: vendedorId,
          monto_total: '250.00',
          num_nota: '1234',
          contado_credito: 'credito',
          semana: 31,
          mes: 8,
          status: 'abonado',
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    await db
      .insertInto('cobranza_abono')
      .values({
        venta_nota_id: notaId,
        fecha_pago: '2026-08-03',
        vendedor_id: vendedorId,
        monto: '100.00',
        tipo: 'abono',
        saldo_pendiente: '150.00',
        metodo_pago: 'efectivo',
      })
      .execute();

    bearer = (await entrar()).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('cobranza_abono')
      .where('venta_nota_id', '=', notaId)
      .execute();
    await db.deleteFrom('venta_nota').where('id', '=', notaId).execute();
    await db
      .deleteFrom('cliente_precio')
      .where('id', '=', clientePrecioId)
      .execute();
    await db.deleteFrom('precio').where('id', '=', precioId).execute();
    await db
      .deleteFrom('cliente')
      .where('id', 'in', [clienteId, clienteAjenoId])
      .execute();
    await db
      .deleteFrom('presentacion')
      .where('id', '=', presentacionId)
      .execute();
    await db.deleteFrom('producto').where('id', '=', productoId).execute();
    await db.deleteFrom('vehiculo').where('id', '=', vehiculoId).execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('sesion_refresh')
      .where('usuario_id', '=', usuarioPortalId)
      .execute();
    await db.deleteFrom('usuario').where('id', '=', usuarioPortalId).execute();
    await app.close();
  });

  /* ================================================================ */
  /* Autenticacion: son endpoints de la APP, no del portal            */
  /* ================================================================ */

  describe('solo entra la app', () => {
    it('sin encabezado Authorization, 401', async () => {
      await request(app.getHttpServer())
        .get(`/sync/pull?contrato=${CONTRATO_ACTUAL}`)
        .expect(401);
      await request(app.getHttpServer())
        .post('/sync/push')
        .send({ contrato: CONTRATO_ACTUAL, operaciones: [operacion()] })
        .expect(401);
    });

    it('un token del PORTAL no entra ni al pull ni al push', async () => {
      // El caso real que esto impide: un administrador con sesion en el portal
      // (o un XSS en el portal) empujando operaciones como si fuera una tablet.
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login: LOGIN_PORTAL, password: PASSWORD })
        .expect(200);

      const cookies = login.headers['set-cookie'] as unknown as string[];
      const acceso = cookies
        .find((c) => c.startsWith('jawa_access='))
        ?.split(';')[0]
        ?.split('=')[1];
      expect(acceso).toBeDefined();

      // Como cookie: el endpoint de la app ni la mira.
      await request(app.getHttpServer())
        .get(`/sync/pull?contrato=${CONTRATO_ACTUAL}`)
        .set('Cookie', [`jawa_access=${acceso}`])
        .expect(401);

      // Como Bearer: lo lee, pero el claim `tipo` es 'usuario'.
      const comoBearer = await request(app.getHttpServer())
        .get(`/sync/pull?contrato=${CONTRATO_ACTUAL}`)
        .set('Authorization', `Bearer ${acceso}`)
        .expect(401);
      expect((comoBearer.body as RespuestaError).message).toBe(
        'Sesion invalida o vencida.',
      );

      await request(app.getHttpServer())
        .post('/sync/push')
        .set('Authorization', `Bearer ${acceso}`)
        .send({ contrato: CONTRATO_ACTUAL, operaciones: [operacion()] })
        .expect(401);
    });

    it('un vendedor desactivado con token vivo no sincroniza', async () => {
      // El guard valida la firma del token, no que el vendedor siga existiendo.
      await db
        .updateTable('vendedor')
        .set({ activo: false })
        .where('id', '=', vendedorId)
        .execute();
      try {
        await pull().expect(401);
      } finally {
        await db
          .updateTable('vendedor')
          .set({ activo: true })
          .where('id', '=', vendedorId)
          .execute();
      }
      await pull().expect(200);
    });
  });

  /* ================================================================ */
  /* Version del contrato                                             */
  /* ================================================================ */

  describe('version del contrato', () => {
    it('una tablet mas nueva que el servidor recibe 409, no un error confuso', async () => {
      const res = await pull({ contrato: CONTRATO_ACTUAL + 1 }).expect(409);
      const cuerpo = res.body as RespuestaError;
      expect(cuerpo.codigo).toBe('contrato-incompatible');
      expect(String(cuerpo.message)).toContain('Actualiza el servidor');
    });

    it('el push tambien exige el contrato', async () => {
      const res = await push({
        contrato: CONTRATO_ACTUAL + 5,
        operaciones: [operacion()],
      }).expect(409);
      expect((res.body as RespuestaError).codigo).toBe('contrato-incompatible');
    });

    it('sin contrato es 400: no se asume una version', async () => {
      await request(app.getHttpServer())
        .get('/sync/pull')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(400);
    });

    it('toda respuesta dice con que contrato se genero', async () => {
      const res = await pull().expect(200);
      expect((res.body as RespuestaPull).contrato).toBe(CONTRATO_ACTUAL);

      const p = await push({ operaciones: [operacion()] }).expect(200);
      expect((p.body as RespuestaPush).contrato).toBe(CONTRATO_ACTUAL);
    });
  });

  /* ================================================================ */
  /* PULL                                                             */
  /* ================================================================ */

  describe('pull', () => {
    it('baja los catalogos de SU sucursal, los precios resueltos y las notas pendientes', async () => {
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;

      expect(cuerpo.completo).toBe(true);
      expect(cuerpo.desde).toBeNull();
      expect(cuerpo.sucursal.codigo).toBe(sucursalCodigo);
      expect(cuerpo.vendedor.id).toBe(vendedorId);

      // Catalogo de clientes: con precio, % comision y coordenadas, que es lo
      // que pide el criterio de aceptacion del ticket.
      const cliente = cuerpo.catalogos.clientes.find((c) => c.id === clienteId);
      expect(cliente).toBeDefined();
      expect(cliente?.pct_comision).toBe(3.5);
      expect(cliente?.lat).toBeCloseTo(32.5149, 4);
      expect(cliente?.lng).toBeCloseTo(-117.0382, 4);
      expect(cliente?.promocion).toBe('10+1');
      expect(cliente?.plazo_credito_dias).toBe(7);
      expect(cliente?.activo).toBe(1);

      // Productos y vehiculos.
      expect(cuerpo.catalogos.productos.some((p) => p.id === productoId)).toBe(
        true,
      );
      expect(
        cuerpo.catalogos.presentaciones.some((p) => p.id === presentacionId),
      ).toBe(true);
      expect(cuerpo.catalogos.vehiculos.some((v) => v.id === vehiculoId)).toBe(
        true,
      );

      // Notas pendientes, en centavos y con el saldo del ultimo abono.
      const nota = cuerpo.notas_pendientes.find((n) => n.id === notaId);
      expect(nota).toBeDefined();
      expect(nota?.status).toBe('abonado');
      expect(nota?.monto_total_centavos).toBe(25000);
      expect(nota?.saldo_centavos).toBe(15000);
      expect(nota?.cliente_id).toBe(clienteId);
    });

    it('NO baja clientes de otra sucursal', async () => {
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;
      expect(
        cuerpo.catalogos.clientes.some((c) => c.id === clienteAjenoId),
      ).toBe(false);
    });

    it('solo baja SU propia ficha de vendedor, no la de sus companeros', async () => {
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;
      expect(cuerpo.catalogos.vendedores.map((v) => v.id)).toEqual([
        vendedorId,
      ]);
    });

    it('el precio llega YA RESUELTO, en centavos, con el override ganandole a la lista', async () => {
      // La lista dice 10.10 y el cliente tiene un especial de 8.00: la tablet
      // no resuelve listas en campo, recibe el precio que aplica. Ver
      // [[Lista de precios]].
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;

      const precio = cuerpo.catalogos.precios.find(
        (p) =>
          p.cliente_id === clienteId && p.presentacion_id === presentacionId,
      );
      expect(precio).toBeDefined();
      expect(precio?.precio_centavos).toBe(800);
      // Y el id es sintetico: si fuera el de la fila de origen, dos clientes de
      // la misma lista chocarian en la llave primaria de la tablet.
      expect(precio?.id).toBe(`${clienteId}:${presentacionId}`);
    });

    it('sin override, el precio sale de la lista sin perder centavos', async () => {
      // 10.10 es el caso que delata `Number(x) * 100`.
      await db
        .updateTable('cliente_precio')
        .set({ deleted_at: new Date() })
        .where('id', '=', clientePrecioId)
        .execute();
      try {
        const res = await pull().expect(200);
        const precio = (res.body as RespuestaPull).catalogos.precios.find(
          (p) =>
            p.cliente_id === clienteId && p.presentacion_id === presentacionId,
        );
        expect(precio?.precio_centavos).toBe(1010);
      } finally {
        await db
          .updateTable('cliente_precio')
          .set({ deleted_at: null })
          .where('id', '=', clientePrecioId)
          .execute();
      }
    });

    it('un `desde` ilegible es 400, no un vuelco completo silencioso', async () => {
      await pull({ desde: 'ayer por la tarde' }).expect(400);
    });

    describe('incremental', () => {
      it('con `desde` solo bajan las filas que cambiaron', async () => {
        const primero = (await pull().expect(200)).body as RespuestaPull;

        // Se usa `servidor_en` y no `cursor` A PROPOSITO: el cursor va unos
        // segundos por detras para no perder transacciones sin commit, asi que
        // reenvia de mas — y aqui hay que medir la incrementalidad, no el
        // margen de seguridad. La tablet si usa `cursor`; ver el contrato.
        const corte = primero.servidor_en;

        const vacio = (await pull({ desde: corte }).expect(200))
          .body as RespuestaPull;
        expect(vacio.completo).toBe(false);
        expect(vacio.catalogos.clientes.some((c) => c.id === clienteId)).toBe(
          false,
        );
        expect(vacio.catalogos.vehiculos.some((v) => v.id === vehiculoId)).toBe(
          false,
        );

        // Ahora se toca UNA fila.
        await db
          .updateTable('vehiculo')
          .set({ nombre: `Camioneta renombrada ${SUFIJO}` })
          .where('id', '=', vehiculoId)
          .execute();

        const despues = (await pull({ desde: corte }).expect(200))
          .body as RespuestaPull;
        const vehiculo = despues.catalogos.vehiculos.find(
          (v) => v.id === vehiculoId,
        );
        expect(vehiculo?.nombre).toBe(`Camioneta renombrada ${SUFIJO}`);
        // Y lo que no se toco sigue sin bajar.
        expect(despues.catalogos.clientes.some((c) => c.id === clienteId)).toBe(
          false,
        );
      });

      it('el cursor va por detras del reloj del servidor, a proposito', async () => {
        // Es lo que evita perder una transaccion que fijo su updated_at pero
        // aun no habia hecho commit al leer. Si alguien "arreglara" esto
        // igualandolos, esta prueba lo detiene.
        const cuerpo = (await pull().expect(200)).body as RespuestaPull;
        expect(Date.parse(cuerpo.cursor)).toBeLessThan(
          Date.parse(cuerpo.servidor_en),
        );
      });

      it('una BAJA en el portal viaja como bandera `activo: 0`, no como ausencia', async () => {
        // Es la politica de purga que [[Sincronizacion offline]] dejo abierta:
        // la tablet aplica upsert (no puede borrar filas que su jornada
        // referencia), asi que si la baja llegara como ausencia, el cliente
        // dado de baja se quedaria ahi para siempre.
        const corte = ((await pull().expect(200)).body as RespuestaPull)
          .servidor_en;

        await db
          .updateTable('cliente')
          .set({ deleted_at: new Date() })
          .where('id', '=', clienteId)
          .execute();

        try {
          const res = (await pull({ desde: corte }).expect(200))
            .body as RespuestaPull;
          const cliente = res.catalogos.clientes.find(
            (c) => c.id === clienteId,
          );
          expect(cliente).toBeDefined();
          expect(cliente?.activo).toBe(0);
        } finally {
          await db
            .updateTable('cliente')
            .set({ deleted_at: null })
            .where('id', '=', clienteId)
            .execute();
        }
      });

      it('desactivar un vehiculo tambien viaja como bandera', async () => {
        const corte = ((await pull().expect(200)).body as RespuestaPull)
          .servidor_en;
        await db
          .updateTable('vehiculo')
          .set({ activo: false })
          .where('id', '=', vehiculoId)
          .execute();
        try {
          const res = (await pull({ desde: corte }).expect(200))
            .body as RespuestaPull;
          expect(
            res.catalogos.vehiculos.find((v) => v.id === vehiculoId)?.activo,
          ).toBe(0);
        } finally {
          await db
            .updateTable('vehiculo')
            .set({ activo: true })
            .where('id', '=', vehiculoId)
            .execute();
        }
      });
    });

    describe('alcance', () => {
      it('pedir su propia sucursal por su codigo es correcto', async () => {
        const res = await pull({ sucursal: sucursalCodigo }).expect(200);
        expect((res.body as RespuestaPull).sucursal.codigo).toBe(
          sucursalCodigo,
        );
      });

      it('pedir OTRA sucursal responde 403', async () => {
        const res = await pull({ sucursal: sucursalAjenaCodigo }).expect(403);
        expect((res.body as RespuestaError).message).toBe(
          'No tienes acceso a esa sucursal.',
        );
      });

      it('pedir "todas" devuelve la suya, no un error', async () => {
        // No nombra una sucursal ajena, asi que no es escalada: es el selector
        // que quedo puesto. Mismo criterio que T-09.
        const res = await pull({ sucursal: 'todas' }).expect(200);
        expect((res.body as RespuestaPull).sucursal.codigo).toBe(
          sucursalCodigo,
        );
      });
    });
  });

  /* ================================================================ */
  /* PUSH                                                             */
  /* ================================================================ */

  describe('push', () => {
    it('sube la operacion del dia y devuelve un id por operacion', async () => {
      const ops = [
        operacion({
          tipo: 'jornada',
          datos: { km_inicial: 100, km_final: 240 },
        }),
        operacion({
          tipo: 'venta',
          cliente_id: clienteId,
          datos: { lineas: [] },
        }),
        operacion({
          tipo: 'cobranza',
          cliente_id: clienteId,
          datos: { monto_centavos: 15000 },
        }),
        operacion({
          tipo: 'gasto',
          datos: { concepto: 'hielo', monto_centavos: 5000 },
        }),
        operacion({ tipo: 'merma', datos: { piezas: 3 } }),
        operacion({ tipo: 'ruta', datos: { visitas: [] } }),
      ];

      const res = await push({ operaciones: ops }).expect(200);
      const cuerpo = res.body as RespuestaPush;

      expect(cuerpo.resumen).toEqual({
        recibidas: 6,
        aplicadas: 6,
        duplicadas: 0,
        rechazadas: 0,
      });
      expect(cuerpo.resultados).toHaveLength(6);
      for (const r of cuerpo.resultados) {
        expect(r.estado).toBe('aplicada');
        expect(r.id_servidor).toBeTruthy();
      }
    });

    describe('idempotencia', () => {
      it('reenviar EL MISMO lote no duplica nada y devuelve los mismos ids', async () => {
        // Es el caso real: la WiFi del negocio se cae a media subida y la
        // tablet reintenta. Reenviar no puede cobrar dos veces.
        const ops = [operacion(), operacion(), operacion()];

        const primero = (await push({ operaciones: ops }).expect(200))
          .body as RespuestaPush;
        expect(primero.resumen.aplicadas).toBe(3);

        const segundo = (await push({ operaciones: ops }).expect(200))
          .body as RespuestaPush;
        expect(segundo.resumen).toEqual({
          recibidas: 3,
          aplicadas: 0,
          duplicadas: 3,
          rechazadas: 0,
        });

        // Y el id devuelto es EL MISMO. Es lo que hace que, cuando T-14 emita
        // el folio al proyectar, un reenvio devuelva ese mismo folio en vez de
        // emitir uno nuevo.
        expect(segundo.resultados.map((r) => r.id_servidor)).toEqual(
          primero.resultados.map((r) => r.id_servidor),
        );

        // Y en la base hay UNA fila por clave, no dos.
        const filas = await db
          .selectFrom('sync_operacion')
          .select('id')
          .where('vendedor_id', '=', vendedorId)
          .where(
            'clave_idempotencia',
            'in',
            ops.map((o) => o.clave),
          )
          .execute();
        expect(filas).toHaveLength(3);
      });

      it('un lote parcialmente reenviado aplica solo lo nuevo', async () => {
        const vieja = operacion();
        await push({ operaciones: [vieja] }).expect(200);

        const nueva = operacion();
        const res = (await push({ operaciones: [vieja, nueva] }).expect(200))
          .body as RespuestaPush;

        expect(res.resumen).toEqual({
          recibidas: 2,
          aplicadas: 1,
          duplicadas: 1,
          rechazadas: 0,
        });
        expect(res.resultados[0].estado).toBe('duplicada');
        expect(res.resultados[1].estado).toBe('aplicada');
      });

      it('la misma clave de OTRO vendedor no colisiona', async () => {
        // El unique es (vendedor_id, clave): dos tablets no comparten espacio
        // de nombres. Si el unique fuera solo por clave, una tablet podria
        // bloquear las operaciones de otra.
        const compartida = operacion({ clave: `compartida-${SUFIJO}` });
        await push({ operaciones: [compartida] }).expect(200);

        const otro = await entrar(LOGIN_AJENO);
        const res = await request(app.getHttpServer())
          .post('/sync/push')
          .set('Authorization', `Bearer ${otro.tokenAcceso}`)
          .send({ contrato: CONTRATO_ACTUAL, operaciones: [compartida] })
          .expect(200);

        expect((res.body as RespuestaPush).resultados[0].estado).toBe(
          'aplicada',
        );
      });

      it('dos operaciones con la misma clave EN EL MISMO lote: la segunda se rechaza', async () => {
        // No es un reintento, es un bug del cliente. Llamarlo "duplicada" lo
        // escondería.
        const repetida = operacion();
        const res = (
          await push({ operaciones: [repetida, { ...repetida }] }).expect(200)
        ).body as RespuestaPush;

        expect(res.resultados[0].estado).toBe('aplicada');
        expect(res.resultados[1].estado).toBe('rechazada');
        expect(res.resultados[1].codigo).toBe('clave-repetida-en-el-lote');
      });
    });

    describe('push parcial y honesto', () => {
      it('con 3 malas de 50, entran 47 y la respuesta dice cuales fallaron y por que', async () => {
        const buenas = Array.from({ length: 47 }, () => operacion());
        const malas = [
          operacion({ tipo: 'consumo-personal' }), // tipo que este servidor no conoce
          operacion({ fecha_operacion: '2027-01-01' }), // reloj de la tablet mal puesto
          operacion({ cliente_id: clienteAjenoId }), // cliente de otra sucursal
        ];
        const lote = [
          ...buenas.slice(0, 20),
          malas[0],
          ...buenas.slice(20, 40),
          malas[1],
          ...buenas.slice(40),
          malas[2],
        ];

        const res = (await push({ operaciones: lote }).expect(200))
          .body as RespuestaPush;

        expect(res.resumen).toEqual({
          recibidas: 50,
          aplicadas: 47,
          duplicadas: 0,
          rechazadas: 3,
        });

        const rechazadas = res.resultados.filter(
          (r) => r.estado === 'rechazada',
        );
        expect(rechazadas.map((r) => r.codigo).sort()).toEqual([
          'cliente-fuera-de-alcance',
          'fecha-futura',
          'tipo-desconocido',
        ]);
        // Cada rechazo trae su motivo legible ademas del codigo.
        for (const r of rechazadas) {
          expect(r.motivo).toBeTruthy();
          expect(r.id_servidor).toBeUndefined();
        }

        // El orden de los resultados es el del lote: la tablet los empareja por
        // posicion sin tener que buscar.
        expect(res.resultados).toHaveLength(50);
        expect(res.resultados[20].codigo).toBe('tipo-desconocido');
        expect(res.resultados[49].codigo).toBe('cliente-fuera-de-alcance');

        // Y lo aplicado esta de verdad en la base.
        const guardadas = await db
          .selectFrom('sync_operacion')
          .select('id')
          .where('vendedor_id', '=', vendedorId)
          .where(
            'clave_idempotencia',
            'in',
            buenas.map((o) => o.clave),
          )
          .execute();
        expect(guardadas).toHaveLength(47);
      });

      it('una operacion RECHAZADA no consume su clave: se puede corregir y reenviar', async () => {
        // Si el rechazo dejara fila, esa fila local quedaria rechazada para
        // siempre y el vendedor no podria corregir un dato mal capturado.
        const clave = `corregible-${SUFIJO}`;
        const mala = operacion({ clave, fecha_operacion: '2027-06-01' });

        const primero = (await push({ operaciones: [mala] }).expect(200))
          .body as RespuestaPush;
        expect(primero.resultados[0].estado).toBe('rechazada');

        const corregida = operacion({ clave });
        const segundo = (await push({ operaciones: [corregida] }).expect(200))
          .body as RespuestaPush;
        expect(segundo.resultados[0].estado).toBe('aplicada');
      });

      it('un lote vacio es 400: no hay nada honesto que responder', async () => {
        await push({ operaciones: [] }).expect(400);
      });

      it('un cliente_id que no es uuid se rechaza solo, sin reventar el lote', async () => {
        // Sin la validacion de formato, ese valor llega a `where id in (...)` y
        // Postgres tumba la peticion entera con "invalid input syntax for type
        // uuid" -> 500 para las 3 operaciones. Y la tablet traduce un 5xx a
        // "sin red", asi que reintentaria ese lote para siempre, en silencio.
        const buena1 = operacion();
        const corrupta = operacion({
          tipo: 'venta',
          cliente_id: 'no-soy-uuid',
        });
        const buena2 = operacion({ tipo: 'venta', cliente_id: clienteId });

        const res = (
          await push({ operaciones: [buena1, corrupta, buena2] }).expect(200)
        ).body as RespuestaPush;

        expect(res.resumen).toEqual({
          recibidas: 3,
          aplicadas: 2,
          duplicadas: 0,
          rechazadas: 1,
        });
        expect(res.resultados[1].codigo).toBe('cliente-fuera-de-alcance');
        expect(res.resultados[0].estado).toBe('aplicada');
        expect(res.resultados[2].estado).toBe('aplicada');
      });

      it('una operacion ilegible se rechaza sola, sin tumbar el lote', async () => {
        const res = (
          await push({
            operaciones: ['no soy una operacion', operacion()],
          }).expect(200)
        ).body as RespuestaPush;
        expect(res.resultados[0].estado).toBe('rechazada');
        expect(res.resultados[0].codigo).toBe('datos-invalidos');
        expect(res.resultados[1].estado).toBe('aplicada');
      });
    });

    describe('alcance', () => {
      it('atribuir una operacion a OTRO vendedor responde 403 y no guarda nada', async () => {
        const buena = operacion();
        const ajena = operacion({ vendedor_id: vendedorAjenoId });

        const res = await push({ operaciones: [buena, ajena] }).expect(403);
        expect((res.body as RespuestaError).message).toBe(
          'No puedes sincronizar operaciones de otro vendedor.',
        );

        // Ni siquiera la buena entro: el lote se valida entero antes de escribir.
        const filas = await db
          .selectFrom('sync_operacion')
          .select('id')
          .where('vendedor_id', '=', vendedorId)
          .where('clave_idempotencia', '=', buena.clave)
          .execute();
        expect(filas).toHaveLength(0);
      });

      it('empujar contra OTRA sucursal responde 403', async () => {
        await push({
          sucursal: sucursalAjenaCodigo,
          operaciones: [operacion()],
        }).expect(403);
      });

      it('una operacion sobre un cliente de otra sucursal se rechaza (no es 403)', async () => {
        // Es un snapshot viejo, no un ataque: el portal pudo mover o dar de
        // baja al cliente mientras el vendedor estaba en ruta.
        const res = (await push({
          operaciones: [
            operacion({ tipo: 'venta', cliente_id: clienteAjenoId }),
          ],
        }).expect(200)) as { body: RespuestaPush };
        expect(res.body.resultados[0].codigo).toBe('cliente-fuera-de-alcance');
      });

      it('la operacion se guarda a nombre del vendedor del TOKEN, no del cuerpo', async () => {
        const op = operacion();
        await push({ operaciones: [op] }).expect(200);

        const fila = await db
          .selectFrom('sync_operacion')
          .select(['vendedor_id', 'sucursal_id', 'tipo', 'contrato'])
          .where('clave_idempotencia', '=', op.clave)
          .where('vendedor_id', '=', vendedorId)
          .executeTakeFirstOrThrow();

        expect(fila.vendedor_id).toBe(vendedorId);
        expect(fila.sucursal_id).toBe(sucursalId);
        expect(fila.contrato).toBe(CONTRATO_ACTUAL);
      });
    });

    it('guarda el dia de trabajo tal cual lo mando la tablet, sin re-derivarlo de UTC', async () => {
      // 2026-08-08T01:00Z son las 18:00 del dia 7 en Tijuana. El dia de trabajo
      // es el 7; derivarlo del instante en UTC daria el 8 y partiria la jornada.
      const op = operacion({
        fecha_operacion: '2026-08-07',
        ocurrido_en: '2026-08-08T01:00:00.000Z',
      });
      await push({ operaciones: [op] }).expect(200);

      const fila = await db
        .selectFrom('sync_operacion')
        .select(['fecha_operacion', 'ocurrido_en'])
        .where('vendedor_id', '=', vendedorId)
        .where('clave_idempotencia', '=', op.clave)
        .executeTakeFirstOrThrow();

      const fecha =
        fila.fecha_operacion instanceof Date
          ? `${fila.fecha_operacion.getFullYear()}-${String(fila.fecha_operacion.getMonth() + 1).padStart(2, '0')}-${String(fila.fecha_operacion.getDate()).padStart(2, '0')}`
          : String(fila.fecha_operacion).slice(0, 10);
      expect(fecha).toBe('2026-08-07');
      expect(new Date(fila.ocurrido_en).toISOString()).toBe(
        '2026-08-08T01:00:00.000Z',
      );
    });
  });
  /* ================================================================ */
  /* Folios (T-14)                                                    */
  /* ================================================================ */

  /**
   * El folio lo emite la **tablet, offline** (ADR-0001 descarta generarlo en el
   * servidor: se escribe en la nota fisica que el cliente firma, en campo). Lo
   * que el servidor hace es **no aceptarlo en silencio**: comprueba que sea
   * coherente con la operacion y deja que un unique de la base detecte las
   * colisiones.
   */
  describe('folios', () => {
    /** Una venta con folio bien emitido para este vendedor y este dia. */
    const conFolio = (
      extra: Record<string, unknown> = {},
      fecha = '2026-08-07',
      consecutivo = 1,
    ) => {
      const base = operacion({
        tipo: 'venta',
        fecha_operacion: fecha,
        ocurrido_en: `${fecha}T14:03:22.000-07:00`,
        folio: formarFolio(sucursalCodigo, fecha, segmento, consecutivo),
        ...extra,
      });
      return base;
    };

    const filasConFolio = async (folio: string) =>
      db
        .selectFrom('sync_operacion')
        .select(['id', 'vendedor_id', 'clave_idempotencia'])
        .where('folio', '=', folio)
        .execute();

    it('el pull manda el segmento de vendedor: la tablet no lo deriva sola', async () => {
      // Es la pieza que hace posible emitir offline SIN ambiguedad. La tablet
      // solo baja su propia ficha, asi que no puede saber si comparte
      // iniciales con un companero; el servidor se lo dice.
      const res = await pull().expect(200);
      const cuerpo = res.body as RespuestaPull;

      expect(cuerpo.vendedor.folio_segmento).toBe(segmento);
      expect(cuerpo.catalogos.vendedores[0].folio_segmento).toBe(segmento);
      expect(segmento).toMatch(/^[A-Z]{2}$/);
    });

    it('acepta una operacion con folio y lo guarda tal cual', async () => {
      const op = conFolio({}, '2026-08-07', 11);
      const res = await push({ operaciones: [op] }).expect(200);

      expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
        estado: 'aplicada',
      });

      const fila = await db
        .selectFrom('sync_operacion')
        .select('folio')
        .where('vendedor_id', '=', vendedorId)
        .where('clave_idempotencia', '=', op.clave)
        .executeTakeFirstOrThrow();
      expect(fila.folio).toBe(op.folio);
    });

    it('la jornada sigue subiendo SIN folio', async () => {
      // No es una nota que nadie firme: no lleva folio, y el indice unico es
      // parcial justo para que varias operaciones sin folio convivan.
      await push({ operaciones: [operacion(), operacion()] })
        .expect(200)
        .expect((r) => {
          expect((r.body as RespuestaPush).resumen.aplicadas).toBe(2);
        });
    });

    /* ---------------------------------------------------------------- */

    describe('deteccion de colision', () => {
      it('DOS TABLETS del mismo vendedor emiten el mismo folio: la segunda se rechaza', async () => {
        // El caso real: al vendedor le dan una tablet de repuesto y entra con
        // su mismo login. Cada tablet lleva su propio contador local en SQLite,
        // las dos arrancan el dia en 01 y las dos emiten el mismo folio — con
        // claves de idempotencia distintas, porque son filas locales distintas.
        //
        // Esto NO es un reintento: son dos hechos de negocio que dicen tener el
        // mismo identificador. Aceptarlo haria imposible cotejar las notas
        // fisicas para siempre.
        const folio = formarFolio(sucursalCodigo, '2026-08-07', segmento, 21);

        const primera = await push({
          operaciones: [conFolio({ folio }, '2026-08-07')],
        }).expect(200);
        expect((primera.body as RespuestaPush).resultados[0].estado).toBe(
          'aplicada',
        );

        const segunda = await push({
          operaciones: [conFolio({ folio }, '2026-08-07')],
        }).expect(200);
        expect((segunda.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-duplicado',
        });

        // Y en la base quedo UNA sola fila con ese folio.
        expect(await filasConFolio(folio)).toHaveLength(1);
      });

      it('el rechazo por colision NO deja fila: la operacion se puede corregir y reenviar', async () => {
        // Misma doctrina que el resto de rechazos de T-07. Si la fila quedara,
        // consumiria su clave y esa operacion local quedaria rechazada para
        // siempre — el vendedor no podria mandarla con un folio corregido.
        const folio = formarFolio(sucursalCodigo, '2026-08-07', segmento, 22);
        await push({ operaciones: [conFolio({ folio })] }).expect(200);

        const rechazada = conFolio({ folio });
        await push({ operaciones: [rechazada] }).expect(200);

        const sinFila = await db
          .selectFrom('sync_operacion')
          .select('id')
          .where('vendedor_id', '=', vendedorId)
          .where('clave_idempotencia', '=', rechazada.clave)
          .executeTakeFirst();
        expect(sinFila).toBeUndefined();

        // Corregido el folio, la MISMA fila local entra.
        const corregida = {
          ...rechazada,
          folio: formarFolio(sucursalCodigo, '2026-08-07', segmento, 23),
        };
        const res = await push({ operaciones: [corregida] }).expect(200);
        expect((res.body as RespuestaPush).resultados[0].estado).toBe(
          'aplicada',
        );
      });

      it('la colision se detecta tambien dentro del mismo lote', async () => {
        const folio = formarFolio(sucursalCodigo, '2026-08-07', segmento, 24);
        const res = await push({
          operaciones: [conFolio({ folio }), conFolio({ folio })],
        }).expect(200);

        const cuerpo = res.body as RespuestaPush;
        expect(cuerpo.resultados[0].estado).toBe('aplicada');
        expect(cuerpo.resultados[1]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-duplicado',
        });
        expect(await filasConFolio(folio)).toHaveLength(1);
      });
    });

    /* ---------------------------------------------------------------- */

    describe('la idempotencia sigue mandando por encima del folio', () => {
      it('REENVIAR el mismo lote con folio devuelve `duplicada`, NO una colision', async () => {
        // Un reenvio trae la MISMA clave y el MISMO folio, asi que choca
        // contra los dos uniques a la vez. Tiene que resolverse como
        // `duplicada` y no como colision: si se reportara como colision, los
        // reintentos normales (la WiFi que se cae a media subida) dejarian la
        // operacion en error y la tablet los repetiria para siempre.
        //
        // La clave identifica el TRANSPORTE, el folio el HECHO DE NEGOCIO
        // (T-07/ADR-0006). Mismo transporte = duplicada.
        //
        // En secuencial esto lo resuelve el `on conflict (vendedor_id,
        // clave_idempotencia) do nothing`: el indice arbitro se comprueba
        // primero y el insert ni se intenta, asi que el unique del folio nunca
        // llega a dispararse. El caso en el que si se dispara es concurrente,
        // y va en la prueba de abajo.
        const op = conFolio({}, '2026-08-07', 31);

        const primera = await push({ operaciones: [op] }).expect(200);
        const segunda = await push({ operaciones: [op] }).expect(200);
        const tercera = await push({ operaciones: [op] }).expect(200);

        const r1 = (primera.body as RespuestaPush).resultados[0];
        const r2 = (segunda.body as RespuestaPush).resultados[0];
        const r3 = (tercera.body as RespuestaPush).resultados[0];

        expect(r1.estado).toBe('aplicada');
        expect(r2.estado).toBe('duplicada');
        expect(r3.estado).toBe('duplicada');

        // Y el MISMO id de servidor las tres veces: la identidad de la
        // operacion no cambia entre intentos, que es lo que hace que reenviar
        // sea seguro de punta a punta.
        expect(r2.id_servidor).toBe(r1.id_servidor);
        expect(r3.id_servidor).toBe(r1.id_servidor);

        expect(await filasConFolio(op.folio as string)).toHaveLength(1);
      });

      it('dos reintentos SIMULTANEOS del mismo lote: uno aplica, el otro duplica', async () => {
        // La WiFi del negocio va y viene y la tablet reintenta; nada impide que
        // dos peticiones identicas se solapen en el servidor.
        //
        // Lo que esta prueba garantiza: pase lo que pase con el solape, las
        // dos peticiones convergen en UNA fila y **ninguna** se reporta como
        // colision de folio.
        //
        // Que camino toman por dentro depende de si las transacciones llegan a
        // solaparse, y eso no se puede forzar desde aqui. En la practica gana
        // el `on conflict ... do nothing`. El desempate por clave del
        // repositorio cubre el caso en que no: ver el comentario de
        // `guardarOperacion`.
        const op = conFolio({}, '2026-08-07', 32);

        const respuestas = await Promise.all([
          push({ operaciones: [op] }),
          push({ operaciones: [op] }),
        ]);

        const estados = respuestas.map(
          (r) => (r.body as RespuestaPush).resultados[0],
        );

        // Ninguna de las dos puede acabar como colision de folio.
        for (const r of estados) {
          expect(r.codigo).toBeUndefined();
          expect(['aplicada', 'duplicada']).toContain(r.estado);
        }

        // Y las dos apuntan a la MISMA fila del servidor.
        expect(estados[0].id_servidor).toBe(estados[1].id_servidor);
        expect(await filasConFolio(op.folio as string)).toHaveLength(1);
      });
    });

    /* ---------------------------------------------------------------- */

    describe('coherencia: el folio no puede contradecir a su operacion', () => {
      it('rechaza un folio de otra sucursal', async () => {
        // La sucursal la decide el servidor desde el token (T-09).
        const op = conFolio({
          folio: formarFolio(sucursalAjenaCodigo, '2026-08-07', segmento, 41),
        });
        const res = await push({ operaciones: [op] }).expect(200);
        expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-invalido',
        });
      });

      it('rechaza un folio cuya fecha contradice a `fecha_operacion`', async () => {
        const op = operacion({
          tipo: 'venta',
          fecha_operacion: '2026-08-07',
          ocurrido_en: '2026-08-07T14:03:22.000-07:00',
          folio: formarFolio(sucursalCodigo, '2026-08-06', segmento, 42),
        });
        const res = await push({ operaciones: [op] }).expect(200);
        expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-invalido',
        });
      });

      it('rechaza un folio con el segmento de OTRO vendedor', async () => {
        // Esto es lo que impide que una tablet se invente las iniciales por su
        // cuenta en vez de usar las que le mando el pull. Sin esta
        // comprobacion, la ambiguedad de iniciales volveria en silencio.
        const op = conFolio({
          folio: formarFolio(sucursalCodigo, '2026-08-07', segmentoAjeno, 43),
        });
        const res = await push({ operaciones: [op] }).expect(200);
        expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-invalido',
        });
      });

      it.each([
        ['TJ260807AP', 'demasiado corto'],
        ['tj260807ap01', 'minusculas'],
        ['TJ261332AP01', 'una fecha que no existe'],
        ['no-es-un-folio', 'cualquier cosa'],
      ])('rechaza %p (%s)', async (folio) => {
        const res = await push({
          operaciones: [conFolio({ folio })],
        }).expect(200);
        expect((res.body as RespuestaPush).resultados[0]).toMatchObject({
          estado: 'rechazada',
          codigo: 'folio-invalido',
        });
      });

      it('un folio malo rechaza SU operacion, no el lote', async () => {
        // La promesa de T-07: 200 y detalle por operacion. Un dedazo en un
        // folio no le puede costar el dia entero al vendedor.
        const res = await push({
          operaciones: [
            operacion(),
            conFolio({ folio: 'no-es-un-folio' }),
            conFolio({}, '2026-08-07', 51),
          ],
        }).expect(200);

        const cuerpo = res.body as RespuestaPush;
        expect(cuerpo.resumen).toMatchObject({
          recibidas: 3,
          aplicadas: 2,
          rechazadas: 1,
        });
        expect(cuerpo.resultados.map((r) => r.estado)).toEqual([
          'aplicada',
          'rechazada',
          'aplicada',
        ]);
      });
    });
  });
});
