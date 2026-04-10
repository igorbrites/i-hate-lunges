interface Env {
  ASSETS: Fetcher;
}

const DOMAIN_LOCALE_MAP: Record<string, string> = {
  "euodeioafundo.com.br": "pt",
  "ihatelunges.com": "en",
};

const PASSTHROUGH_PATTERN =
  /^\/(_(astro|worker)|favicon\.ico|robots\.txt|sitemap|images\/|fonts\/)|\.[\w]+$/;

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  if (PASSTHROUGH_PATTERN.test(url.pathname)) {
    return context.next();
  }

  if (url.pathname.startsWith("/pt/") || url.pathname.startsWith("/en/")) {
    return context.next();
  }

  const hostname = url.hostname;
  const locale =
    Object.entries(DOMAIN_LOCALE_MAP).find(([domain]) =>
      hostname.includes(domain),
    )?.[1] ?? "en";

  const rewrittenPath =
    url.pathname === "/" ? `/${locale}/` : `/${locale}${url.pathname}`;
  url.pathname = rewrittenPath;

  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
};
