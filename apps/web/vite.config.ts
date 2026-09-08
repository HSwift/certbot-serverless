import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "LOCAL_");
  const bearerToken = env.LOCAL_API_BEARER_TOKEN;
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:8788",
          headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined,
        },
        "/download": "http://localhost:8788",
      },
    },
  };
});
