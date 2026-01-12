import { Component } from 'solid-js'
import { useI18n, type Locale } from '../../../i18n'
import { Select } from './Select'

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
]

export interface LanguageSwitcherProps {
  class?: string
}

export const LanguageSwitcher: Component<LanguageSwitcherProps> = (props) => {
  const { locale, setLocale } = useI18n()

  const handleChange = (e: Event) => {
    const target = e.target as HTMLSelectElement
    const newLocale = target.value as Locale
    setLocale(newLocale)
  }

  return (
    <Select
      value={locale()}
      options={LANGUAGE_OPTIONS}
      onChange={handleChange}
      class={props.class}
    />
  )
}
