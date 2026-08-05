import { NextResponse, type NextRequest } from "next/server";

/**
 * Solo comprueba que EXISTA la cookie de sesion, no valida la firma: la
 * validacion real la hace la API. Asi no duplicamos el secreto en dos servicios.
 */
export function middleware(req: NextRequest) {
  const tieneSesion = req.cookies.has("jawa_access") || req.cookies.has("jawa_refresh");

  if (!tieneSesion) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Todo menos /login, los assets de Next y el favicon.
  //
  // La exencion de "login" va anclada al limite de segmento con "(?:/|$)":
  // sin eso, la negacion es por PREFIJO y cualquier ruta que empiece con la
  // cadena "login" (p. ej. /login-historial o /loginfalso) quedaria exenta
  // de proteccion sin que nada avise. "_next/static" y "_next/image" no
  // necesitan el mismo anclaje: "/_next" es un namespace reservado por
  // Next.js, ninguna ruta de la app puede definirse bajo ese prefijo, asi
  // que no hay colision posible con una pagina real del portal.
  matcher: ["/((?!login(?:/|$)|_next/static|_next/image|favicon.ico).*)"],
};
