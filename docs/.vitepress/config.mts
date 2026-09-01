import { defineConfig } from "vitepress";
// @ts-ignore generated at build time
import typedocSidebar from "../api/typedoc-sidebar.json";

const SITE_URL = "https://foxdb.xwx.gg";
const OG_IMAGE = "/og-banner.png";

export default defineConfig({
  title: "foxdb",
  titleTemplate: ":title - foxdb",
  description: "itty bitty typebox-powered ORM for Bun :3 (might bite~)",
  base: "/",
  lang: "en-US",
  cleanUrls: true,
  metaChunk: true,

  srcExclude: ["**/README.md", "**/TODO.md"],

  head: [
    ["link", { rel: "icon", href: "/foxdb.svg", type: "image/svg+xml" }],
    ["meta", { name: "theme-color", content: "#1e1e2e" }],
    ["meta", { property: "og:site_name", content: "foxdb" }],
    ["meta", { property: "og:image", content: `${SITE_URL}${OG_IMAGE}` }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: `${SITE_URL}${OG_IMAGE}` }],
  ],

  appearance: "dark",

  markdown: {
    theme: {
      light: "catppuccin-latte",
      dark: "catppuccin-mocha",
    },
    lineNumbers: true,
  },

  lastUpdated: true,

  themeConfig: {
    logo: "/foxdb.svg",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/" },
      { text: "GitHub", link: "https://github.com/xwxfox/foxdb" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Core Concepts", link: "/guide/core-concepts" },
            { text: "Examples", link: "/guide/examples" },
            { text: "API Reference", link: "/api" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API Reference",
          items: typedocSidebar,
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/xwxfox/foxdb" },
    ],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/xwxfox/foxdb/edit/master/docs/:path",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © xwxfox",
    },
  },

  // Build hooks

  // Runs in both dev and production - injects per-page metadata automatically
  transformPageData(pageData, { siteConfig }) {
    const ogImageUrl = `${SITE_URL}${OG_IMAGE}`;
    const canonical = `${SITE_URL}/${pageData.relativePath}`
      .replace(/index\.md$/, "")
      .replace(/\.md$/, ".html");

    const title = pageData.title || siteConfig.site.title;
    const description = pageData.description || siteConfig.site.description;

    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(
      ["link", { rel: "canonical", href: canonical }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { property: "og:url", content: canonical }],
      ["meta", { property: "og:image", content: ogImageUrl }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: description }],
      ["meta", { name: "twitter:image", content: ogImageUrl }],
      ["meta", { name: "twitter:url", content: canonical }]
    );
  },

  async buildEnd({ outDir }) {
    const fs = await import("fs/promises");
    const path = await import("path");

    const pages: string[] = [];

    async function collect(dir: string, base: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await collect(full, path.join(base, entry.name));
        } else if (entry.name.endsWith(".html")) {
          let url = path.join(base, entry.name).replace(/\\/g, "/");
          url = url.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
          if (url === "404") continue;
          pages.push(url);
        }
      }
    }

    try {
      await collect(outDir, "");
      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...pages.map(
          (p) =>
            `  <url><loc>${encodeURI(`${SITE_URL}/${p}`)}</loc></url>`
        ),
        "</urlset>",
      ].join("\n");

      await fs.writeFile(path.join(outDir, "sitemap.xml"), sitemap, "utf-8");
      console.log(`[foxdb] Sitemap generated with ${pages.length} pages`);
    } catch (err) {
      console.error("[foxdb] Failed to generate sitemap:", err);
    }
  },
});
