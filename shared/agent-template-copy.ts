// Localized agent-template copy. Other languages are adapted from public
// upstream catalogs with Bureau naming; English task instructions stay in
// ui/agent-templates.ts and win when present.
import type { SupportedLanguageCode } from "./languages.ts";
import { TEMPLATE_COPY, type TemplateCopy } from "./agent-template-catalog.ts";

export type { TemplateCopy };
export { TEMPLATE_COPY };

export type SharedWorkflowCopy = {
  firstTurn: string;
  personalSoftware: string;
  scopeAgreement: string;
  appsRegistration: string;
  plainLanguage: string;
};

export const SHARED_WORKFLOW_COPY: Record<SupportedLanguageCode, SharedWorkflowCopy> = {
  en: {
    firstTurn: "To start, learn what the user wants and propose a direction.",
    personalSoftware: "When software could help, and only then, propose a small personalized tool shaped around this user's real workflow and constraints.",
    scopeAgreement: "Before you build software, agree with the user on scope.",
    appsRegistration: "After you build it, register it through Bureau and tell the user that it appears in the Apps tab and can be opened from any device that can access the office.",
    plainLanguage: "Do not use jargon when talking to the user. Do not use technical language unless you have established that they are technical.",
  },
  es: {
    firstTurn: "Para empezar, averigua qué quiere el usuario y propón una dirección.",
    personalSoftware:
      "Cuando el software pueda ayudar (y *solo* entonces), propón una pequeña herramienta personalizada adaptada al flujo de trabajo real y las limitaciones de este usuario. Antes de crear software, acuerda el alcance con el usuario. Después de crearlo, regístralo a través de Bureau e indica al usuario que aparece en la pestaña Apps y se puede abrir desde cualquier dispositivo que tenga acceso a la oficina.",
    scopeAgreement: "Antes de construir software, acuerda el alcance con el usuario.",
    appsRegistration: "Después de construirlo, regístralo a través de Bureau y dile al usuario que aparece en la pestaña Apps y se puede abrir desde cualquier dispositivo que acceda a la oficina.",
    plainLanguage: "No uses jerga al hablar con el usuario. No uses lenguaje técnico a menos que hayas confirmado que tiene conocimientos técnicos.",
  },
  ca: {
    firstTurn: "Per començar, esbrina què vol l'usuari i proposa una direcció.",
    personalSoftware:
      "Quan el programari pugui ajudar (i *només* aleshores), proposa una petita eina personalitzada adaptada al flux de treball real i les limitacions d'aquest usuari. Abans de crear programari, acorda'n l'abast amb l'usuari. Després de crear-lo, registra'l a través d'Bureau i indica a l'usuari que apareix a la pestanya Apps i es pot obrir des de qualsevol dispositiu que tingui accés a l'oficina.",
    scopeAgreement: "Abans de construir programari, acorda l'abast amb l'usuari.",
    appsRegistration: "Després de construir-lo, registra'l a través de Bureau i digues a l'usuari que apareix a la pestanya Apps i es pot obrir des de qualsevol dispositiu que accedeixi a l'oficina.",
    plainLanguage: "No facis servir argot quan parlis amb l'usuari. No facis servir llenguatge tècnic tret que hagis confirmat que té coneixements tècnics.",
  },
  zh: {
    firstTurn: "首先，了解用户的需求，并提出一个方向。",
    personalSoftware:
      "当软件能有所帮助时（而且*仅在此时*），提出一个小型个性化工具方案，使其符合这位用户的实际工作流程和限制条件。开发软件前，先与用户就范围达成一致。开发完成后，通过 Bureau 注册，并告诉用户它会出现在 App 套件中，任何能访问办公室的设备都可以打开它。",
    scopeAgreement: "在构建软件之前，先与用户就范围达成一致。",
    appsRegistration: "构建完成后，通过 Bureau 注册，并告诉用户它会出现在 Apps 标签页中，可从能访问办公室的任何设备打开。",
    plainLanguage: "与用户交谈时不要使用行话。除非已确认用户有技术背景，否则不要使用技术性语言。",
  },
} as const;

export function templateCopyFor(language: SupportedLanguageCode, key: string): TemplateCopy | undefined {
  return TEMPLATE_COPY[language]?.[key] ?? TEMPLATE_COPY.en[key];
}

export function sharedWorkflowFor(language: SupportedLanguageCode): SharedWorkflowCopy {
  return SHARED_WORKFLOW_COPY[language] ?? SHARED_WORKFLOW_COPY.en;
}

export function composeTemplateInstructions(language: SupportedLanguageCode, key: string, englishTaskInstructions: string): string {
  const copy = templateCopyFor(language, key);
  const task = language === "en" || !copy ? englishTaskInstructions : copy.instructions;
  const shared = sharedWorkflowFor(language);
  return [task, shared.firstTurn, shared.personalSoftware, shared.scopeAgreement, shared.appsRegistration, shared.plainLanguage].join("\n\n");
}
