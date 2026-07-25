import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";


// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  // 本番ビルドでは console.log / debug / info を除去する。
  // 障害調査に使う console.error / warn は残す。
  esbuild:
    mode === "production"
      ? { pure: ["console.log", "console.debug", "console.info"] }
      : {},
  plugins: [react(), mode === "development" && componentTagger(), mcpPlugin()].filter(Boolean),
  resolve: {
    alias: {
      // 開発用ダミーデータ（VITE_DEV_FIXTURES）は本番バンドルから物理的に外す。
      // モジュール読み込み時にダミーデータを組み立てる副作用があるため、
      // Rollup の tree-shaking では落ちず、本番JSに架空のジム名等が入ってしまう。
      // より限定的な別名を先に置く必要がある（"@" が先だとそちらが先にマッチしてしまう）。
      ...(mode === "production"
        ? { "@/dev/fixtureClient": path.resolve(__dirname, "./src/dev/fixtureClient.stub.ts") }
        : {}),
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
