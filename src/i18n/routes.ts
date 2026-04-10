import type { Lang } from "./ui";

interface RouteEntry {
  en: string;
  pt: string;
}

export const routes: RouteEntry[] = [
  { en: "/", pt: "/" },
  { en: "/manifesto/", pt: "/manifesto/" },
  { en: "/alternatives/", pt: "/alternativas/" },
  { en: "/in-disguise/", pt: "/disfarce/" },
  { en: "/memes/", pt: "/memes/" },
  { en: "/counter/", pt: "/contador/" },
  { en: "/pledge/", pt: "/juramento/" },
];

export function getLocalePath(lang: Lang, path: string): string {
  const route = routes.find((r) => r.en === path || r.pt === path);
  return route ? route[lang] : path;
}
