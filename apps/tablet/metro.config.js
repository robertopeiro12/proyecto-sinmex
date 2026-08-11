// Metro dentro de un monorepo con npm workspaces.
//
// `npm install` deja las dependencias repartidas en DOS carpetas:
//   - la raiz del monorepo (`<raiz>/node_modules`), donde npm sube todo lo que
//     no colisiona entre workspaces;
//   - `apps/tablet/node_modules`, donde se quedan las que SI colisionan
//     (hoy `react`: el portal fija 19.1.0 y Expo SDK 57 exige 19.2.3, asi que
//     `react` + todo su arbol de React Native vive local).
//
// Metro no hereda la resolucion de Node, asi que hay que decirle explicitamente
// las dos cosas: que VIGILE la raiz (para que el watcher no ignore los paquetes
// que viven ahi) y en que ORDEN resolver los `node_modules`. Sin esto el bundle
// falla con "Unable to resolve module ..." en cuanto un paquete queda hoisted.
//
// Verificado con `npx expo export --platform android` (T-04).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const raizProyecto = __dirname;
const raizMonorepo = path.resolve(raizProyecto, '../..');

const config = getDefaultConfig(raizProyecto);

// 1. Metro vigila todo el monorepo, no solo apps/tablet.
config.watchFolders = [raizMonorepo];

// 2. Resolucion: primero lo local (react/react-native del workspace), luego la raiz.
config.resolver.nodeModulesPaths = [
  path.resolve(raizProyecto, 'node_modules'),
  path.resolve(raizMonorepo, 'node_modules'),
];

// 3. NO se pone `resolver.disableHierarchicalLookup = true`.
//    Es la receta que circula para monorepos de pnpm/yarn, y aqui **rompe el
//    bundle**: npm no aplana todo, tambien anida (p. ej.
//    `apps/tablet/node_modules/expo-router/node_modules/@expo/metro-runtime`).
//    Apagar la busqueda jerarquica deja a Metro sin poder subir del modulo que
//    importa a su propio `node_modules`, y el export falla con
//    "Unable to resolve module @expo/metro-runtime". Comprobado en T-04.

module.exports = config;
