import { useSyncExternalStore } from 'react'
import { getLanguage, onLanguageChange, type Lang } from './index'

/** Subscribes the component to language changes (re-renders on change). */
export function useLanguage(): Lang {
  return useSyncExternalStore(onLanguageChange, getLanguage, getLanguage)
}

export {
  t,
  tn,
  formatNumber,
  formatDate,
  formatTime,
  isRtl,
  getLanguage,
  setLanguage
} from './index'
