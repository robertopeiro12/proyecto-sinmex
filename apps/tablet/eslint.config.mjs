// Config plana de ESLint 9. `eslint-config-expo/flat` trae las reglas de
// React/React Native/TypeScript que Expo mantiene alineadas con cada SDK.
import expoConfig from 'eslint-config-expo/flat.js';

export default [
  ...expoConfig,
  {
    ignores: ['node_modules/**', 'dist/**', '.expo/**', 'expo-env.d.ts'],
  },
];
