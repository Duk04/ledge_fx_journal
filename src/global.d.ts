import type en from "../messages/en.json";
import type { Locale } from "./i18n/config";

// Typed message keys: t("nav.overview") is checked against messages/en.json,
// and a key that exists only in Mongolian (or nowhere) is a type error.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
