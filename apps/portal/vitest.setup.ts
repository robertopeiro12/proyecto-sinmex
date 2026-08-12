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
