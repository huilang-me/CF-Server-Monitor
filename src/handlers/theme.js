const THEMES_URL = 'https://raw.githubusercontent.com/huilang-me/CFSM-Theme-Store/refs/heads/main/themes.json'
const CACHE_TTL = 300

let cachedThemes = null
let cacheTime = 0

export async function handleTheme() {
  const now = Math.floor(Date.now() / 1000)
  if (cachedThemes && (now - cacheTime) < CACHE_TTL) {
    return cachedThemes
  }

  try {
    const res = await fetch(THEMES_URL, {
      headers: { 'User-Agent': 'CFSM-Theme-Store' }
    })

    if (!res.ok) {
      return cachedThemes || []
    }

    const data = await res.json()
    const themes = Array.isArray(data) ? data : []
    cachedThemes = themes
    cacheTime = now
    return themes
  } catch (e) {
    return cachedThemes || []
  }
}
