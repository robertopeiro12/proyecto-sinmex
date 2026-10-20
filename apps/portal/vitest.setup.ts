import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// El auto-cleanup de Testing Library depende de detectar un `afterEach`
// global; Vitest no lo inyecta salvo `test.globals: true` (que no usamos: los
// tests importan describe/it/expect explicitos). Sin esto, el DOM de una
// prueba se queda montado para la siguiente dentro del mismo archivo.
afterEach(() => {
  cleanup();
});

// Node 25+ trae su propio `localStorage` global; sin `--localstorage-file` vale undefined y
// tapa al de jsdom. Las pruebas usan el de jsdom (el mismo que tendría el navegador). Con un
// Node más viejo, o en las pruebas con `@vitest-environment node` (sin jsdom), no se toca nada.
const entorno = globalThis as unknown as { jsdom?: { window: Window } };
if (typeof globalThis.localStorage === "undefined" && entorno.jsdom) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: entorno.jsdom.window.localStorage });
}
