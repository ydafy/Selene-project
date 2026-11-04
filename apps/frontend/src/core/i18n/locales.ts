export interface Language {
  code: 'es' | 'en';
  name: string;
}

export const supportedLanguages: Language[] = [
  {
    code: 'es',
    name: 'Español',
  },
  {
    code: 'en',
    name: 'English',
  },
];
