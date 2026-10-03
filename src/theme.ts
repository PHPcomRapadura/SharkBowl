export type Theme = 'light' | 'dark'

export const themeStorageKey = 'shark-bowl-theme'

export const getPreferredTheme = (): Theme => {
  const stored = localStorage.getItem(themeStorageKey)
  return stored === 'light' || stored === 'dark' ? stored : 'dark'
}

export const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111214' : '#f4f5f7')
}
