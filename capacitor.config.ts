import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.mindvault.mobile',
  appName: 'Mindvault',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: {
    // Routes fetch() through native HTTP, which removes CORS limits so web clipping works on Android.
    CapacitorHttp: { enabled: true },
  },
  android: { backgroundColor: '#060a12' },
}

export default config
