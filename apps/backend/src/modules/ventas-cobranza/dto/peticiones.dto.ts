import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { MOTIVO_SIN_MOTIVO } from '../peticiones.service';

export const MOTIVO_STATUS_BANDEJA = 'Elige pendientes o historial.';

/** `GET /peticiones` (T-34, §3.2). */
export class BandejaDto {
  @IsIn(['pendiente', 'historial'], { message: MOTIVO_STATUS_BANDEJA })
  status!: 'pendiente' | 'historial';

  /** Codigo de sucursal o `todas`: lo interpreta `resolverAlcance`. */
  @IsOptional()
  @IsString()
  sucursal?: string;
}

/**
 * `POST /peticiones/eliminar-cobro`. El motivo se recorta y se mide en el
 * servicio (`normalizarMotivo`): aqui solo se exige que sea texto.
 */
export class SolicitarEliminarCobroDto {
  @IsUUID(undefined, { message: 'Elige el cobro.' })
  cobroId!: string;

  @IsString({ message: MOTIVO_SIN_MOTIVO })
  motivo!: string;
}

/** `POST /peticiones/:id/denegar`. El comentario es opcional. */
export class DenegarPeticionDto {
  @IsOptional()
  @IsString({ message: 'El comentario debe ser texto.' })
  comentario?: string;
}
