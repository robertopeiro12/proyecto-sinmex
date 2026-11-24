import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  ValidateNested,
} from 'class-validator';
import {
  MENSAJE_PIEZAS_PROCESO,
  MENSAJE_TIPO_PROCESO,
  TIPOS_PROCESO,
  type MermaDe,
  type TipoProceso,
} from '../reglas-procesos';

/** El tope de la columna `piezas` (integer): mas alla seria un 500, no un 400. */
const MAX_INTEGER_POSTGRES = 2_147_483_647;
const MENSAJE_FORMATO_FECHA = 'La fecha debe tener el formato AAAA-MM-DD.';

/** `GET /procesos`. Que la fecha exista lo comprueba el servicio. */
export class ConsultaProcesosDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MENSAJE_FORMATO_FECHA })
  fecha!: string;

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString({ message: 'La sucursal no es válida.' })
  sucursal?: string;

  @IsIn(TIPOS_PROCESO, { message: MENSAJE_TIPO_PROCESO })
  tipo!: TipoProceso;

  /** Solo los procesos de ese cliente. */
  @IsOptional()
  @IsUUID(undefined, { message: 'El cliente no es válido.' })
  cliente?: string;
}

/** Una linea de la captura. Sentido, rango y repetidas: `validarProceso`. */
export class LineaProcesoDto {
  @IsUUID(undefined, { message: 'Una de las presentaciones no es válida.' })
  presentacionId!: string;

  @IsString({
    message: 'Una de las líneas no dice si se recibió o se entregó.',
  })
  sentido!: string;

  @IsInt({ message: MENSAJE_PIEZAS_PROCESO })
  @Max(MAX_INTEGER_POSTGRES, { message: MENSAJE_PIEZAS_PROCESO })
  piezas!: number;
}

/** `PATCH /procesos/:id`: reemplaza los datos y las lineas (no el tipo ni la sucursal). */
export class EditarProcesoDto {
  @IsString({ message: 'La fecha no es válida.' })
  fecha!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'El cliente no es válido.' })
  clienteId?: string | null;

  /** null = Oficina. */
  @IsOptional()
  @IsUUID(undefined, { message: 'El vendedor no es válido.' })
  vendedorId?: string | null;

  /** Solo en merma; el valor lo revisa `validarProceso`. */
  @IsOptional()
  @IsString({ message: 'Elige si la merma es de un cliente o del almacén.' })
  mermaDe?: MermaDe | null;

  /** Se recorta en `validarProceso`; vacio = null. */
  @IsOptional()
  @IsString({ message: 'El comentario no es válido.' })
  comentario?: string | null;

  @IsArray({ message: 'Las presentaciones deben ser una lista.' })
  @IsObject({ each: true, message: 'Cada presentación debe ser un objeto.' })
  @ValidateNested({ each: true })
  @Type(() => LineaProcesoDto)
  lineas!: LineaProcesoDto[];
}

/** `POST /procesos`. */
export class CrearProcesoDto extends EditarProcesoDto {
  @IsIn(TIPOS_PROCESO, { message: MENSAJE_TIPO_PROCESO })
  tipo!: TipoProceso;

  /** Codigo de la sucursal donde se registra. */
  @IsString({ message: 'Elige la sucursal.' })
  sucursal!: string;
}
