import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const AUDIENCIAS = ['todos', 'cliente', 'prospecto'] as const;
const COMPRAS = ['cualquiera', 'producto', 'presentacion'] as const;
const REGALOS = ['mismo', 'producto', 'presentacion'] as const;
/** `integer` de Postgres. */
const MAX_PIEZAS = 2_147_483_647;

/** `POST /promociones` (T-74). La coherencia entre campos la decide `problemaDeRegla`. */
export class CrearPromocionDto {
  /**
   * uuid de la sucursal, o `'todas'` (solo un General: crea una por sucursal).
   * Se ignora con `audiencia = 'cliente'` (manda la del cliente) y para un
   * usuario atado a una sucursal (manda la suya).
   */
  @IsOptional()
  @ValidateIf((o: CrearPromocionDto) => o.sucursalId !== 'todas')
  @IsUUID(undefined, { message: 'Elige la sucursal.' })
  sucursalId?: string;

  @IsIn(AUDIENCIAS, { message: 'Elige para quién es la promoción.' })
  audiencia!: (typeof AUDIENCIAS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el cliente de la promoción.' })
  clienteId?: string;

  @IsIn(COMPRAS, { message: 'Elige qué se compra.' })
  compraTipo!: (typeof COMPRAS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el producto que se compra.' })
  compraProductoId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige la presentación que se compra.' })
  compraPresentacionId?: string;

  @IsInt({ message: 'La cantidad de compra son piezas enteras.' })
  @Min(0)
  @Max(MAX_PIEZAS)
  compraCantidad!: number;

  @IsIn(REGALOS, { message: 'Elige qué se regala.' })
  regaloTipo!: (typeof REGALOS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el producto que se regala.' })
  regaloProductoId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige la presentación que se regala.' })
  regaloPresentacionId?: string;

  @IsInt({ message: 'Se regala al menos 1 pieza.' })
  @Min(1, { message: 'Se regala al menos 1 pieza.' })
  @Max(MAX_PIEZAS)
  regaloCantidad!: number;

  @IsBoolean()
  seRepite!: boolean;
}

/**
 * `PATCH /promociones/:id`: la regla completa otra vez (el formulario manda el
 * estado entero) mas `activo`. Para cambiar de audiencia, cliente o sucursal
 * se crea otra: esos tres no se editan.
 */
export class EditarPromocionDto {
  @IsIn(COMPRAS, { message: 'Elige qué se compra.' })
  compraTipo!: (typeof COMPRAS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el producto que se compra.' })
  compraProductoId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige la presentación que se compra.' })
  compraPresentacionId?: string;

  @IsInt({ message: 'La cantidad de compra son piezas enteras.' })
  @Min(0)
  @Max(MAX_PIEZAS)
  compraCantidad!: number;

  @IsIn(REGALOS, { message: 'Elige qué se regala.' })
  regaloTipo!: (typeof REGALOS)[number];

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige el producto que se regala.' })
  regaloProductoId?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Elige la presentación que se regala.' })
  regaloPresentacionId?: string;

  @IsInt({ message: 'Se regala al menos 1 pieza.' })
  @Min(1, { message: 'Se regala al menos 1 pieza.' })
  @Max(MAX_PIEZAS)
  regaloCantidad!: number;

  @IsBoolean()
  seRepite!: boolean;

  @IsBoolean()
  activo!: boolean;
}
