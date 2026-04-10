export const languages = {
  en: "English",
  pt: "Português",
} as const;

export type Lang = keyof typeof languages;

export const defaultLang: Lang = "en";

export const domains: Record<Lang, string> = {
  en: "https://ihatelunges.com",
  pt: "https://euodeioafundo.com.br",
};

export const ui: Record<Lang, Record<string, string>> = {
  en: {
    "site.title": "I Hate Lunges",
    "site.description":
      "A sanctuary for those who refuse to lunge. Join the movement.",
    "nav.home": "Home",
    "nav.manifesto": "Manifesto",
    "nav.alternatives": "Alternatives",
    "nav.disguise": "In Disguise",
    "nav.memes": "Memes",
    "nav.counter": "Counter",
    "nav.pledge": "Pledge",
    "footer.copyright": "No lunges were performed in the making of this site.",
    "theme.light": "Light mode",
    "theme.dark": "Dark mode",
    "lang.switch": "Ler em Português",
  },
  pt: {
    "site.title": "Eu Odeio Afundo",
    "site.description":
      "Um refúgio para quem se recusa a fazer afundo. Junte-se ao movimento.",
    "nav.home": "Início",
    "nav.manifesto": "Manifesto",
    "nav.alternatives": "Alternativas",
    "nav.disguise": "Disfarçados",
    "nav.memes": "Memes",
    "nav.counter": "Contador",
    "nav.pledge": "Juramento",
    "footer.copyright":
      "Nenhum afundo foi realizado na criação deste site.",
    "theme.light": "Modo claro",
    "theme.dark": "Modo escuro",
    "lang.switch": "Read in English",
  },
};
