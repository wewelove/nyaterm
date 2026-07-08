import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ko from "./locales/ko.json";
import zhCN from "./locales/zh-CN.json";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
    ko: { translation: ko },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export const AVAILABLE_LANGUAGES = [
  { id: "en", name: "English" },
  { id: "zh-CN", name: "中文 (简体)" },
  { id: "ko", name: "한국어" },
];

export default i18n;
