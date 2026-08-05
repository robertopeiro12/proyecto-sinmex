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
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
