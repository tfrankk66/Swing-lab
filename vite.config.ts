import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Phone testing: run `npm run dev` and open http://<your-lan-ip>:5173 on the handset.
    host: true,
    port: 5173,
  },
});
