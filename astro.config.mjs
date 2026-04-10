import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://ihatelunges.com",
  output: "static",
  integrations: [sitemap()],
  i18n: {
    locales: ["pt", "en"],
    defaultLocale: "en",
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
  build: {
    format: "directory",
  },
});
