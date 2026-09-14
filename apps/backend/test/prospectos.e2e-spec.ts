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
 * Alta de prospectos desde la app (T-40), de punta a punta.
 *
 * Archivo propio y no dentro de `sincronizacion.e2e-spec.ts` por dos razones:
 * ese archivo ya pasa de 1 400 lineas y lo esta reescribiendo T-16 en paralelo,
 * y estas pruebas tienen sus propias fixtures (dos vendedores de sucursales
 * distintas y un catalogo de tipos de negocio) que no le sirven a nadie mas.
 *
 * Lo que verifica, que es lo que se rompe en silencio si no se prueba:
 *
 * 1. El alta se proyecta a `cliente` con `tipo = 'prospecto'`, en la sucursal
 *    del vendedor del **token**.
 * 2. **Idempotencia**: el mismo lote dos veces devuelve `duplicada` y deja
 *    **un solo** cliente.
 * 3. Un prospecto que dice ser de otra sucursal es **403 para todo el lote**.
 * 4. El `domicilio` nulo se acepta en un prospecto y se **rechaza** en un
 *    cliente (es el check de la migracion, visto desde la API).
 * 5. El catalogo `tipos_negocio` **baja en el pull**.
 */

// El PID va pegado al timestamp: Jest corre archivos en paralelo, en procesos
// distintos, y dos suites que arrancan en el mismo milisegundo generarian el
// mismo prefijo — el `afterAll` de una borraria filas que la otra necesita.
// Patron de PR #82.
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN = `e2e-prosp-${SUFIJO}`;
const LOGIN_AJENO = `e2e-prosp-ajeno-${SUFIJO}`;
const PASSWORD = 'contrasena-del-vendedor';
const PREFIJO = `ZZ-prosp-${SUFIJO}`;

interface FilaCliente {
  id: string;
  nombre: string;
  domicilio: string | null;
  telefono: string;
  encargado: string | null;
  tipo: string;
  tipo_negocio_id: string | null;
  lista_precio_id: string | null;
  comentarios: string | null;
  lat: string | null;
  lng: string | null;
  sucursal_id: string;
}

describe('Prospectos desde la app (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalId: string;
  let sucursalCodigo: string;
  let sucursalAjenaId: string;
  let vendedorId: string;
  let vendedorAjenoId: string;
  let segmento: string;
  let tipoNegocioId: string;
  let tipoNegocioBorradoId: string;
  let listaId: string;
  let bearer: string;

  const push = (cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ contrato: CONTRATO_ACTUAL, ...cuerpo });

  const pull = () =>
    request(app.getHttpServer())
      .get(`/sync/pull?contrato=${CONTRATO_ACTUAL}`)
      .set('Authorization', `Bearer ${bearer}`);

  /** Un alta de prospecto valida, con clave unica por defecto. */
  const alta = (extra: Record<string, unknown> = {}) => ({
    clave: `prosp-${SUFIJO}-${Math.random().toString(36).slice(2)}`,
    tipo: 'prospecto',
    fecha_operacion: '2026-09-14',
    ocurrido_en: '2026-09-14T18:03:22.000Z',
    datos: {
      nombre: `${PREFIJO} Tacos Aaron`,
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipo_negocio_id: tipoNegocioId,
      comentarios: 'Quiere probar jamaica',
      lat: 32.5149,
      lng: -117.0382,
      foto: null,
    },
    ...extra,
  });

  /**
   * Una columna `date` de Postgres, como `AAAA-MM-DD`.
   *
   * `pg` la parsea a un `Date` de JS a la **medianoche local del proceso**, asi
   * que `toISOString()` (que es UTC) corre la fecha un dia hacia atras en
   * cualquier maquina con huso adelantado de UTC — el entorno de este equipo
   * (Europe/Madrid) es exactamente ese caso. Se leen los componentes locales.
   */
  const fechaDePg = (valor: unknown): string => {
    if (typeof valor === 'string') return valor.slice(0, 10);
    const d = valor as Date;
    const mes = `${d.getMonth() + 1}`.padStart(2, '0');
    const dia = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  };

  const clientePorNombre = (nombre: string): Promise<FilaCliente[]> =>
    db.selectFrom('cliente').selectAll().where('nombre', '=', nombre).execute();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

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

    listaId = (
      await db
        .selectFrom('lista_precio')
        .select('id')
        .where('deleted_at', 'is', null)
        .orderBy('nombre')
        .executeTakeFirstOrThrow()
    ).id;

    const passwordHash = await new PasswordService().hashear(PASSWORD);

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN,
          nombre: 'Vendedor prospectos',
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

    // Segmento del folio: consulta global, como en `sincronizacion.e2e-spec.ts`.
    // No hace falta para un prospecto (no lleva folio), pero sin el no se puede
    // probar el caso "llega con folio", que si lo necesita coherente.
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
    segmento = asignarSegmento('Prospectos Uno', ocupados) as string;
    await db
      .updateTable('vendedor')
      .set({ folio_segmento: segmento })
      .where('id', '=', vendedorId)
      .execute();

    tipoNegocioId = (
      await db
        .insertInto('tipo_negocio')
        .values({ nombre: `${PREFIJO} Taqueria` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    tipoNegocioBorradoId = (
      await db
        .insertInto('tipo_negocio')
        .values({ nombre: `${PREFIJO} Ciber`, deleted_at: new Date() })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const login = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('tipo_negocio')
      .where('id', 'in', [tipoNegocioId, tipoNegocioBorradoId])
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await app.close();
  });

  /* ---------------------------------------------------------------- */
  /* 1. El alta se proyecta                                            */
  /* ---------------------------------------------------------------- */

  it('proyecta el alta a un cliente con tipo prospecto, en la sucursal del token', async () => {
    const op = alta();
    const res = await push({ operaciones: [op] }).expect(200);
    const cuerpo = res.body as RespuestaPush;

    expect(cuerpo.resumen).toMatchObject({
      recibidas: 1,
      aplicadas: 1,
      rechazadas: 0,
    });
    expect(cuerpo.resultados[0]).toMatchObject({
      clave: op.clave,
      estado: 'aplicada',
    });

    const filas = await clientePorNombre(`${PREFIJO} Tacos Aaron`);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      nombre: `${PREFIJO} Tacos Aaron`,
      telefono: '6641112233',
      encargado: 'Don Aaron',
      tipo: 'prospecto',
      tipo_negocio_id: tipoNegocioId,
      comentarios: 'Quiere probar jamaica',
      // La sucursal sale del TOKEN, no del cuerpo.
      sucursal_id: sucursalId,
    });
    // `numeric` llega como cadena desde `pg`.
    expect(Number(filas[0].lat)).toBeCloseTo(32.5149, 4);
    expect(Number(filas[0].lng)).toBeCloseTo(-117.0382, 4);

    // Lo que el vendedor NO decide: se queda nulo para que lo complete el portal.
    expect(filas[0].domicilio).toBeNull();
    expect(filas[0].lista_precio_id).toBeNull();

    // ADR-0009 §2.4 (enmendado): la trazabilidad va en el buzon, sin columna
    // nueva en `cliente`. Es el camino que necesita la notificacion Prospectos.
    const buzon = await db
      .selectFrom('sync_operacion')
      .select([
        'entidad_tabla',
        'entidad_id',
        'vendedor_id',
        'fecha_operacion',
        'folio',
      ])
      .where('clave_idempotencia', '=', op.clave)
      .executeTakeFirstOrThrow();
    expect(buzon.entidad_tabla).toBe('cliente');
    expect(buzon.entidad_id).toBe(filas[0].id);
    expect(buzon.vendedor_id).toBe(vendedorId);
    // `pg` entrega una columna `date` como `Date` de JS. Lo que importa es que
    // el servidor guardo el dia que mando la tablet **sin re-derivarlo de UTC**.
    expect(fechaDePg(buzon.fecha_operacion)).toBe('2026-09-14');
    // Un prospecto no consume folio: el `unique` global queda libre.
    expect(buzon.folio).toBeNull();
  });

  it('acepta un alta sin ubicacion: negar el permiso no puede bloquear el registro', async () => {
    const op = alta({
      datos: {
        nombre: `${PREFIJO} Sin Ubicacion`,
        telefono: '6649998877',
        encargado: null,
        tipo_negocio_id: null,
        comentarios: null,
        lat: null,
        lng: null,
        foto: null,
      },
    });
    await push({ operaciones: [op] }).expect(200);

    const filas = await clientePorNombre(`${PREFIJO} Sin Ubicacion`);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      lat: null,
      lng: null,
      tipo_negocio_id: null,
    });
  });

  /* ---------------------------------------------------------------- */
  /* 2. Idempotencia                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * El fallo que esto evita es el peor posible de este sistema: la WiFi del
   * negocio se cae a media subida, la tablet reintenta, y el mismo prospecto
   * queda dos veces en la cartera. `cliente` **no tiene** clave natural (dos
   * negocios pueden llamarse igual), asi que lo unico que lo impide es el
   * `unique (vendedor_id, clave_idempotencia)` del buzon.
   */
  it('el mismo lote dos veces: duplicada y UN SOLO cliente', async () => {
    const op = alta({
      datos: { ...alta().datos, nombre: `${PREFIJO} Reenviado` },
    });

    const primera = (await push({ operaciones: [op] }).expect(200))
      .body as RespuestaPush;
    expect(primera.resultados[0]).toMatchObject({ estado: 'aplicada' });

    const segunda = (await push({ operaciones: [op] }).expect(200))
      .body as RespuestaPush;
    expect(segunda.resumen).toMatchObject({
      aplicadas: 0,
      duplicadas: 1,
      rechazadas: 0,
    });
    expect(segunda.resultados[0]).toMatchObject({ estado: 'duplicada' });
    // El MISMO id de servidor que devolvio el primer envio.
    expect(segunda.resultados[0].id_servidor).toBe(
      primera.resultados[0].id_servidor,
    );

    // Y lo que de verdad importa: un solo cliente.
    expect(await clientePorNombre(`${PREFIJO} Reenviado`)).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- */
  /* 3. Alcance                                                        */
  /* ---------------------------------------------------------------- */

  it('un alta atribuida a otro vendedor es 403 para TODO el lote', async () => {
    const buena = alta({
      datos: { ...alta().datos, nombre: `${PREFIJO} No Debe Entrar` },
    });
    const ajena = alta({ vendedor_id: vendedorAjenoId });

    await push({ operaciones: [buena, ajena] }).expect(403);

    // No se guardo nada, ni la buena: escribir en nombre de otro vendedor no es
    // un fallo parcial, es un cliente que no deberia estar mandando eso.
    expect(await clientePorNombre(`${PREFIJO} No Debe Entrar`)).toHaveLength(0);
  });

  it('pedir otra sucursal en el lote es 403', async () => {
    await push({ sucursal: 'XX', operaciones: [alta()] }).expect(403);
  });

  /* ---------------------------------------------------------------- */
  /* 4. Rechazos por operacion                                         */
  /* ---------------------------------------------------------------- */

  it('un prospecto con folio se rechaza, y el folio NO queda consumido', async () => {
    const folio = formarFolio(sucursalCodigo, '2026-09-14', segmento, 77);
    const op = alta({
      folio,
      datos: { ...alta().datos, nombre: `${PREFIJO} Con Folio` },
    });

    const cuerpo = (await push({ operaciones: [op] }).expect(200))
      .body as RespuestaPush;
    expect(cuerpo.resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'datos-invalidos',
    });
    expect(cuerpo.resultados[0].motivo).toMatch(/folio/i);

    // Una operacion rechazada NO deja fila (contrato §7), asi que ese folio
    // sigue libre para la venta que de verdad lo lleve.
    expect(await clientePorNombre(`${PREFIJO} Con Folio`)).toHaveLength(0);
    const enBuzon = await db
      .selectFrom('sync_operacion')
      .select('id')
      .where('folio', '=', folio)
      .execute();
    expect(enBuzon).toHaveLength(0);
  });

  it('un prospecto con cliente_id se rechaza: lo esta creando', async () => {
    const op = alta({
      cliente_id: '00000000-0000-4000-8000-000000000000',
      datos: { ...alta().datos, nombre: `${PREFIJO} Con Cliente` },
    });

    const cuerpo = (await push({ operaciones: [op] }).expect(200))
      .body as RespuestaPush;
    // Gana el alcance del cliente, que se comprueba antes: ese uuid no existe en
    // su sucursal. El resultado para el vendedor es el mismo (rechazo por
    // operacion con motivo) y lo que importa es que NO se cree el prospecto.
    expect(cuerpo.resultados[0].estado).toBe('rechazada');
    expect(await clientePorNombre(`${PREFIJO} Con Cliente`)).toHaveLength(0);
  });

  it('un tipo de negocio dado de baja se rechaza con su codigo propio', async () => {
    const op = alta({
      datos: {
        ...alta().datos,
        nombre: `${PREFIJO} Giro Borrado`,
        tipo_negocio_id: tipoNegocioBorradoId,
      },
    });

    const cuerpo = (await push({ operaciones: [op] }).expect(200))
      .body as RespuestaPush;
    expect(cuerpo.resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'tipo-negocio-inexistente',
    });

    // Rollback completo: ni el cliente ni la fila del buzon, asi que el reenvio
    // corregido vuelve a entrar con la misma clave.
    expect(await clientePorNombre(`${PREFIJO} Giro Borrado`)).toHaveLength(0);
    const enBuzon = await db
      .selectFrom('sync_operacion')
      .select('id')
      .where('clave_idempotencia', '=', op.clave)
      .execute();
    expect(enBuzon).toHaveLength(0);

    // Y el reenvio con un giro valido entra: es lo que hace que el rechazo sea
    // recuperable en cuanto el administrador arregla el catalogo.
    const corregida = {
      ...op,
      datos: { ...op.datos, tipo_negocio_id: tipoNegocioId },
    };
    const segunda = (await push({ operaciones: [corregida] }).expect(200))
      .body as RespuestaPush;
    expect(segunda.resultados[0]).toMatchObject({ estado: 'aplicada' });
    expect(await clientePorNombre(`${PREFIJO} Giro Borrado`)).toHaveLength(1);
  });

  it('un alta sin nombre de negocio se rechaza nombrando el campo', async () => {
    const op = alta({ datos: { telefono: '664', foto: null } });

    const cuerpo = (await push({ operaciones: [op] }).expect(200))
      .body as RespuestaPush;
    expect(cuerpo.resultados[0]).toMatchObject({
      estado: 'rechazada',
      codigo: 'datos-invalidos',
    });
    expect(cuerpo.resultados[0].motivo).toMatch(/^nombre:/);
  });

  it('una coordenada que no cabe en numeric(9,6) se rechaza y NO revienta el lote', async () => {
    // Sin la comprobacion previa esto seria un 22003 de Postgres, es decir un
    // **500 para todo el lote**, y la tablet lo leeria como "sin red".
    const buena = alta({
      datos: { ...alta().datos, nombre: `${PREFIJO} Vecina Buena` },
    });
    const mala = alta({
      datos: { ...alta().datos, nombre: `${PREFIJO} Lat Absurda`, lat: 1234.5 },
    });

    const cuerpo = (await push({ operaciones: [buena, mala] }).expect(200))
      .body as RespuestaPush;
    expect(cuerpo.resumen).toMatchObject({
      recibidas: 2,
      aplicadas: 1,
      rechazadas: 1,
    });
    expect(cuerpo.resultados[1]).toMatchObject({
      estado: 'rechazada',
      codigo: 'datos-invalidos',
    });
    // La buena entro: el lote no es todo-o-nada.
    expect(await clientePorNombre(`${PREFIJO} Vecina Buena`)).toHaveLength(1);
    expect(await clientePorNombre(`${PREFIJO} Lat Absurda`)).toHaveLength(0);
  });

  /* ---------------------------------------------------------------- */
  /* 5. El check de la migracion, visto desde la base                  */
  /* ---------------------------------------------------------------- */

  describe('domicilio y lista de precios: obligatorios solo para un cliente', () => {
    it('un prospecto sin los dos entra', async () => {
      await expect(
        db
          .insertInto('cliente')
          .values({
            nombre: `${PREFIJO} Prospecto Directo`,
            domicilio: null,
            telefono: '664',
            factura: false,
            tipo: 'prospecto',
            lista_precio_id: null,
            sucursal_id: sucursalId,
          })
          .execute(),
      ).resolves.toBeDefined();
    });

    it('un cliente sin domicilio se rechaza con 23514', async () => {
      await expect(
        db
          .insertInto('cliente')
          .values({
            nombre: `${PREFIJO} Cliente Sin Domicilio`,
            domicilio: null,
            telefono: '664',
            factura: false,
            tipo: 'cliente',
            lista_precio_id: listaId,
            sucursal_id: sucursalId,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('un cliente sin lista de precios se rechaza con 23514', async () => {
      await expect(
        db
          .insertInto('cliente')
          .values({
            nombre: `${PREFIJO} Cliente Sin Lista`,
            domicilio: 'Calle 5 #12',
            telefono: '664',
            factura: false,
            tipo: 'cliente',
            lista_precio_id: null,
            sucursal_id: sucursalId,
          })
          .execute(),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  /* ---------------------------------------------------------------- */
  /* 6. El catalogo baja en el pull                                    */
  /* ---------------------------------------------------------------- */

  it('el pull trae el catalogo de tipos de negocio, con la baja como bandera', async () => {
    const cuerpo = (await pull().expect(200)).body as RespuestaPull;

    const tipos = cuerpo.catalogos.tipos_negocio;
    expect(Array.isArray(tipos)).toBe(true);

    const vivo = tipos.find((t) => t.id === tipoNegocioId);
    expect(vivo).toMatchObject({ nombre: `${PREFIJO} Taqueria`, activo: 1 });

    // La baja viaja como `activo: 0`, nunca como ausencia: la tablet aplica el
    // snapshot con upsert y una fila que desapareciera se quedaria ahi para
    // siempre.
    const borrado = tipos.find((t) => t.id === tipoNegocioBorradoId);
    expect(borrado).toMatchObject({ nombre: `${PREFIJO} Ciber`, activo: 0 });
  });

  it('el prospecto proyectado vuelve a bajar en el pull, con domicilio null', async () => {
    const op = alta({
      datos: { ...alta().datos, nombre: `${PREFIJO} Vuelve En Pull` },
    });
    await push({ operaciones: [op] }).expect(200);

    const cuerpo = (await pull().expect(200)).body as RespuestaPull;
    const fila = cuerpo.catalogos.clientes.find(
      (c) => c.nombre === `${PREFIJO} Vuelve En Pull`,
    );

    expect(fila).toBeDefined();
    expect(fila).toMatchObject({ tipo: 'prospecto', activo: 1 });
    // El nulo que obliga a la migracion local 005 de la tablet: sin ella, este
    // insert tumbaria la transaccion del snapshot entera.
    expect(fila?.domicilio).toBeNull();
  });
});
