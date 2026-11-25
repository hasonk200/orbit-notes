import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.hasonk200.orbit',
  appName: 'Orbit',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
