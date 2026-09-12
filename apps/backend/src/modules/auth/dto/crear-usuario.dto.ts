import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// El indice de unicidad de la migracion es sobre lower(login) (case-insensitive),
// pero AuthService.validarCredenciales compara el login tal cual quedo guardado.
// Se normaliza aqui, al escribir, para que lo que se guarda sea canonico y lo
// que se ve en la lista sea lo que hay que teclear -- no se toca auth.service.ts.
const normalizarLogin = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CrearUsuarioDto {
  @Transform(normalizarLogin)
  @IsString()
  @MinLength(1, { message: 'El login es obligatorio.' })
  @MaxLength(60, { message: 'El login no puede pasar de 60 caracteres.' })
  login!: string;

  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  nombre!: string;

  // D2 del spec: obligatoria en el alta. argon2id produce un hash de tamano
  // fijo sin importar la longitud de entrada -- solo se acota el minimo,
  // mismo umbral que OWASP recomienda para contrasenas sin gestor.
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(200, {
    message: 'La contraseña no puede pasar de 200 caracteres.',
  })
  contrasena!: string;

  @IsUUID()
  perfilId!: string;

  // Solo lo manda -y solo se le hace caso- un usuario General (D8, mismo
  // criterio que sucursalId en CrearClienteDto de T-12). A un usuario atado
  // se le ignora: su formulario ni siquiera pinta el campo.
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  // Estado final marcado (D3), no una lista de excepciones -- el backend
  // calcula la diferencia contra lo que da el perfil elegido. Por CLAVE, no
  // por id: combinarPermisos/calcularExcepciones (permisos.ts) ya operan
  // sobre claves. Siempre presente (puede ser []), igual que
  // `productosPromocion` en CrearClienteDto de T-12.
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permisosMarcados!: string[];
}
