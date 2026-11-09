export type Lang = 'en' | 'fa' | 'ru'
export type LanguageSetting = 'system' | Lang

export type PluralEntry = { one?: string; few?: string; many?: string; other: string }
/** Key = the English source text (for plurals: the `other` English form). */
export type Dict = Record<string, string | PluralEntry>

export const LANGUAGES: readonly Lang[] = ['en', 'fa', 'ru']
