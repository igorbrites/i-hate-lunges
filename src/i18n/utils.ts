import { ui, defaultLang, domains, type Lang } from "./ui";
import { routes, getLocalePath } from "./routes";

export { type Lang, domains, routes };

export function getLangFromUrl(url: URL): Lang {
  const segments = url.pathname.split("/");
  if (segments[1] === "pt") return "pt";
  if (segments[1] === "en") return "en";
  return defaultLang;
}

export function t(lang: Lang, key: string): string {
  return ui[lang][key] ?? ui[defaultLang][key] ?? key;
}

export function getAlternateUrl(lang: Lang, currentPath: string): string {
  const otherLang: Lang = lang === "en" ? "pt" : "en";

  const cleanPath = currentPath
    .replace(/^\/(en|pt)/, "")
    .replace(/\/$/, "")
    .concat("/");
  const normalizedPath = cleanPath === "" ? "/" : cleanPath;

  const localizedPath = getLocalePath(otherLang, normalizedPath);
  return `${domains[otherLang]}${localizedPath}`;
}

export function getNavLinks(lang: Lang): { label: string; href: string }[] {
  return [
    { label: t(lang, "nav.manifesto"), href: getLocalePath(lang, "/manifesto/") },
    { label: t(lang, "nav.alternatives"), href: getLocalePath(lang, "/alternatives/") },
    { label: t(lang, "nav.disguise"), href: getLocalePath(lang, "/in-disguise/") },
    { label: t(lang, "nav.memes"), href: getLocalePath(lang, "/memes/") },
    { label: t(lang, "nav.counter"), href: getLocalePath(lang, "/counter/") },
    { label: t(lang, "nav.pledge"), href: getLocalePath(lang, "/pledge/") },
  ];
}
