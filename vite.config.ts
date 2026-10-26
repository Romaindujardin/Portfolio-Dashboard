import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    port: 5173,
    https: true,
    open: true,
    // Le frontend utilise des URLs relatives (`/api`) en développement comme
    // en production. Vite relaie uniquement l'API vers le backend local.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
        secure: false,
      },
    },
  },
});
