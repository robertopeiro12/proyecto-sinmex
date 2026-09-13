import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// El indice de unicidad de la migracion (Task 1) es sobre lower(login), pero
// AuthVendedorService.validarCredenciales compara el login tal cual quedo
// guardado. Se normaliza aqui, al escribir, igual que CrearUsuarioDto (T-13)
// -- no se toca auth-vendedor.service.ts.
const normalizarLogin = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CrearVendedorDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre!: string;

  @Transform(normalizarLogin)
  @IsString()
  @MinLength(1, { message: 'El login es obligatorio.' })
  @MaxLength(60, { message: 'El login no puede pasar de 60 caracteres.' })
  login!: string;

  // D5 del spec: el cliente confirmo que SIN minimo de longitud ni rotacion
  // para la contraseña del vendedor. Solo se exige que no este vacia -- el
  // tope de 200 es defensivo (mismo que CrearUsuarioDto), no una politica.
  @IsString()
  @MinLength(1, { message: 'La contraseña es obligatoria.' })
  @MaxLength(200, {
    message: 'La contraseña no puede pasar de 200 caracteres.',
  })
  contrasena!: string;

  // Opcional a proposito (D3): solo lo manda -y solo se le hace caso a- un
  // usuario General. A un usuario atado a una sucursal se le IGNORA.
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}
