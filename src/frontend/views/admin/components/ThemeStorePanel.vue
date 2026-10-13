<template>
  <div id="tab-theme-store" class="tab-content" :class="{ active: activeTab === 'themeStore' }">
    <div class="settings-section">
      <div class="section-title"><span>▸</span> {{ trans.themeStore }}</div>

      <div class="warning-box mb-4">
        <div class="flex-center-gap-sm">
          <span class="warning-icon text-xl">⚠️</span>
          <span style="color: var(--accent-yellow); font-weight: 600;">{{ trans.themeStoreWarning }}</span>
        </div>
        <p class="text-secondary text-sm mt-2" style="line-height: 1.6;">{{ trans.themeStoreWarningDesc }}</p>
      </div>

      <div class="theme-store-toolbar mb-4">
        <div class="theme-current">
          <span class="theme-current-label">{{ trans.currentTheme }}</span>
          <span class="theme-current-value">{{ currentThemeLabel }}</span>
        </div>
      </div>

      <div class="theme-custom mb-4">
        <div class="theme-custom-header">
          <div>
            <div class="theme-custom-title">{{ trans.customThemeUrl }}</div>
            <div class="theme-custom-desc">{{ trans.customThemeUrlDesc }}</div>
          </div>
        </div>
        <div class="theme-custom-form">
          <input
            v-model.trim="customThemeUrl"
            type="text"
            class="form-input"
            placeholder="https://github.com/Author/theme/tree/commitid"
            @keyup.enter="applyCustomTheme"
          >
          <button
            @click="previewCustomTheme"
            class="btn"
            :disabled="!customThemeUrl || previewingThemeId === '__custom__'"
          >👁 {{ previewingThemeId === '__custom__' ? trans.saving : trans.preview }}</button>
          <button
            @click="applyCustomTheme"
            class="btn btn-primary"
            :disabled="!customThemeUrl || applyingThemeId === '__custom__'"
          >⇄ {{ applyingThemeId === '__custom__' ? trans.saving : trans.applyCustomTheme }}</button>
          <button
            v-if="currentThemeUrl"
            @click="clearTheme"
            class="btn"
            :disabled="applyingThemeId === '__builtin__'"
          >↩ {{ trans.useBuiltinTheme }}</button>
        </div>
      </div>

      <div v-if="loading" class="theme-loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">$ {{ trans.themeStoreLoading }}...</div>
      </div>

      <div v-else-if="error" class="danger-box mb-4">
        <div class="flex-center-gap-sm">
          <span class="danger-icon text-xl">❌</span>
          <span class="danger-label">{{ error }}</span>
        </div>
        <button @click="loadThemes" class="btn btn-lg mt-2">↻ {{ trans.refresh }}</button>
      </div>

      <div class="theme-grid">
        <div class="theme-card" :class="{ active: isMikusThemeActive }">
          <div class="theme-cover-wrap theme-cover-wrap-mikus">
            <img src="/mikus/loli.gif" alt="Mikus" class="theme-cover theme-cover-mikus" />
          </div>
          <div class="theme-info">
            <div class="theme-header">
              <h3 class="theme-title">Mikus</h3>
            </div>
            <div class="theme-tags">
              <span v-for="tag in mikusThemeTags" :key="tag" class="theme-tag">{{ tag }}</span>
            </div>
            <p class="theme-desc">{{ mikusThemeDescription }}</p>
            <div class="theme-author">by mikus-loli</div>
            <div class="theme-space"></div>
            <div class="theme-actions">
              <button
                @click="enableMikusTheme"
                class="btn btn-sm"
                :class="{ 'btn-primary': applyingThemeId !== '__mikus_enable__' && !isMikusThemeActive }"
                :disabled="applyingThemeId === '__mikus_enable__' || isMikusThemeActive"
              >✓ {{ applyingThemeId === '__mikus_enable__' ? trans.saving : trans.enable }}</button>
              <button
                @click="disableMikusTheme"
                class="btn btn-sm"
                :class="{ 'btn-primary': applyingThemeId !== '__mikus_disable__' && isMikusThemeActive }"
                :disabled="applyingThemeId === '__mikus_disable__' || !isMikusThemeActive"
              >✕ {{ applyingThemeId === '__mikus_disable__' ? trans.saving : trans.close }}</button>
              <a href="https://github.com/mikus-loli/komari-mikus" target="_blank" rel="noopener noreferrer" class="btn btn-sm">↗ {{ trans.view }}</a>
            </div>
          </div>
        </div>

        <div v-for="theme in themes" :key="theme.id" class="theme-card" :class="{ active: isCurrentTheme(theme) }">
          <div class="theme-cover-wrap">
            <img :src="theme.cover" :alt="theme.title" class="theme-cover" @error="handleCoverError" />
          </div>
          <div class="theme-info">
            <div class="theme-header">
              <h3 class="theme-title">{{ theme.title }}</h3>
              <span v-if="getSelectedVersion(theme)" class="theme-version">{{ getVersionBadge(getSelectedVersion(theme)) }}</span>
            </div>
            <div v-if="theme.tags && theme.tags.length" class="theme-tags">
              <span v-for="tag in theme.tags" :key="tag" class="theme-tag">{{ tag }}</span>
            </div>
            <p v-if="getThemeDescription(theme)" class="theme-desc">{{ getThemeDescription(theme) }}</p>
            <div v-if="theme.author" class="theme-author">by {{ theme.author }}</div>
            
            <!-- 版本选择 -->
            <div v-if="theme.versions && theme.versions.length > 0" class="theme-version-selector">
              <label class="version-label">{{ trans.version }}</label>
              <select 
                :value="selectedVersions[theme.id] || 0" 
                @change="selectVersion(theme.id, $event.target.value)"
                class="version-select"
              >
                <option v-for="(v, idx) in theme.versions" :key="v.commitId || idx" :value="idx">
                  {{ getVersionTitle(v) }}
                </option>
              </select>
            </div>
            <div v-else-if="canLoadThemeVersions(theme)" class="theme-version-selector">
              <button
                @click="loadThemeVersions(theme)"
                class="btn btn-sm version-load-btn"
                :disabled="isThemeVersionsLoading(theme)"
              >{{ isThemeVersionsLoading(theme) ? trans.themeLoadingVersions : trans.themeLoadVersions }}</button>
            </div>

            <!-- 当前选中版本信息 -->
            <div v-if="getSelectedVersion(theme)" class="theme-version-info">
              <div v-if="getSelectedVersion(theme).releaseDate" class="version-date">
                📅 {{ getSelectedVersion(theme).releaseDate }}
              </div>
              <div v-if="getSelectedVersion(theme).changelog" class="version-changelog">
                <div class="changelog-label">{{ trans.changelog }}</div>
                <div class="changelog-content">{{ getSelectedVersion(theme).changelog }}</div>
              </div>
            </div>

            <div class="theme-actions">
              <button
                @click="previewTheme(theme)"
                class="btn btn-sm"
                :disabled="!getSelectedThemeUrl(theme) || previewingThemeId === theme.id"
              >👁 {{ previewingThemeId === theme.id ? trans.saving : trans.preview }}</button>
              <button
                @click="applyTheme(theme)"
                class="btn btn-sm btn-primary"
                :disabled="!getSelectedThemeUrl(theme) || applyingThemeId === theme.id"
              >⇄ {{ applyingThemeId === theme.id ? trans.saving : trans.switchTheme }}</button>
              <a v-if="getSafeExternalUrl(theme.url)" :href="getSafeExternalUrl(theme.url)" target="_blank" rel="noopener noreferrer" class="btn btn-sm">↗ {{ trans.view }}</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, reactive } from 'vue'
import http from '../../../utils/http'
import { currentLang } from '../../../utils/i18n'
import { adminApi } from '../../../utils/api'
import { normalizeDisplayMode } from '../../../utils/displayMode'
import { isMikusThemeEnabled } from '../../../utils/themeOptions'
import { APPEARANCE_FIELDS } from '../../../../utils/settings'

const props = defineProps({
  trans: { type: Object, required: true },
  activeTab: { type: String, default: '' },
  selectedApiIndex: { type: Number, default: 0 },
  currentThemeUrl: { type: String, default: '' },
  settings: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['theme-applied', 'theme-options-applied', 'alert-message'])

const THEME_STORE_URL = 'https://raw.githubusercontent.com/huilang-me/CFSM-Theme-Store/refs/heads/main/themes.json'
const THEME_STORE_FETCH_TIMEOUT_MS = 8000
const COMMIT_LIMIT = 10
const GITHUB_FETCH_TIMEOUT_MS = 8000
const SAFE_GITHUB_PART = /^[A-Za-z0-9._-]+$/

const themes = ref([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const applyingThemeId = ref('')
const previewingThemeId = ref('')
const customThemeUrl = ref('')
const selectedVersions = reactive({})
const loadingVersions = reactive({})

const parseThemeOptionsJson = () => {
  const raw = String(props.settings?.theme_options || '').trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch (_) {
    return {}
  }
}

const isMikusThemeActive = computed(() => isMikusThemeEnabled(parseThemeOptionsJson()))
const currentThemeLabel = computed(() => isMikusThemeActive.value ? 'Mikus' : (props.currentThemeUrl || props.trans.builtinTheme))
const mikusThemeTags = computed(() => [props.trans.mikusThemeTagBuiltin, 'Mikus', props.trans.mikusThemeTagSakura])
const mikusThemeDescription = computed(() => props.trans.mikusThemeDescription)

// Derive the appearance payload from the shared APPEARANCE_FIELDS constant so it
// always stays in sync with the backend. The theme store re-sends appearance on
// every apply/switch/Mikus toggle, and the backend overwrites the whole
// appearance_options row — any omitted field would be wiped (e.g. custom_bg_mobile).
// NOTE: this relies on props.settings carrying the current value for every field in
// APPEARANCE_FIELDS. If a field is added to APPEARANCE_FIELDS later, make sure it is
// also populated in the get_settings mapping in views/admin/index.vue, otherwise it
// will be sent as '' here and effectively reset on save.
const buildAppearanceSettings = (themeOptions) => {
  const source = props.settings || {}
  const settings = {}
  for (const field of APPEARANCE_FIELDS) {
    if (field === 'theme_options') continue
    settings[field] = source[field] ?? ''
  }
  settings.display_mode = normalizeDisplayMode(source.display_mode)
  settings.appearance_options = {
    theme_options: themeOptions
  }
  return settings
}

const initSelectedVersions = (reset = false) => {
  themes.value.forEach(theme => {
    if (theme.id && theme.versions && theme.versions.length > 0 && (reset || selectedVersions[theme.id] == null)) {
      selectedVersions[theme.id] = 0
    }
  })
}

const getThemeStoreNetworkError = () => {
  return props.trans.themeStoreNetworkError ||
    'Unable to load the theme store. Please check network access to raw.githubusercontent.com and api.github.com, then retry.'
}

const getThemeStoreLoadFailed = () => {
  return props.trans.themeStoreLoadFailed || 'Failed to load theme store'
}

const showThemeMessage = (message) => {
  if (message) emit('alert-message', message)
}

const normalizeThemeStore = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { schema: 1, themes: [] }
  }

  return {
    ...data,
    schema: data.schema || 1,
    themes: Array.isArray(data.themes) ? data.themes : []
  }
}

const fetchThemeStoreFromRaw = async () => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), THEME_STORE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(THEME_STORE_URL, {
      signal: controller.signal,
      cache: 'no-cache'
    })
    if (!res.ok) throw new Error(`raw.githubusercontent.com ${res.status}`)

    return normalizeThemeStore(await res.json())
  } finally {
    clearTimeout(timeout)
  }
}

const fetchThemeStore = async () => {
  const result = await http.get('/theme')
  if (!result.error) return normalizeThemeStore(result.data)

  return fetchThemeStoreFromRaw()
}

const loadThemes = async () => {
  if (loading.value) return

  loading.value = true
  error.value = ''
  try {
    const themeStore = await fetchThemeStore()
    themes.value = themeStore.themes
    
    // 初始化选中版本为最新版本（索引0）
    initSelectedVersions(true)
    loaded.value = true
  } catch (e) {
    error.value = getThemeStoreLoadFailed()
    showThemeMessage(getThemeStoreNetworkError())
    loaded.value = false
  } finally {
    loading.value = false
  }
}

const getLatestVersion = (theme) => {
  if (!theme.versions || !theme.versions.length) return null
  return theme.versions[0]
}

const getSelectedVersion = (theme) => {
  if (!theme.versions || !theme.versions.length) return null
  const idx = selectedVersions[theme.id] || 0
  return theme.versions[idx] || null
}

const selectVersion = (themeId, idx) => {
  selectedVersions[themeId] = parseInt(idx)
}

const getVersionTitle = (version) => {
  return version?.title || version?.commitId || ''
}

const getVersionBadge = (version) => {
  const shortVersion = String(version?.short_version || version?.shortVersion || '').trim()
  if (shortVersion) return shortVersion

  const commitId = String(version?.commitId || '').trim()
  if (/^[a-f0-9]{40}$/i.test(commitId)) return commitId.slice(0, 7)

  return commitId
}

const normalizeThemeStoreUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return ''
    if (url.username || url.password || url.search || url.hash) return ''

    const parts = url.pathname.split('/').filter(Boolean)
    const ref = parts[3]
    if (
      parts.length < 4 ||
      parts[2] !== 'tree' ||
      !/^[A-Za-z0-9._-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9._-]+$/.test(parts[1]) ||
      !/^[A-Za-z0-9._-]+$/.test(ref) ||
      parts.some(part => part === '.' || part === '..' || /[%\\]/.test(part))
    ) {
      return ''
    }

    return `https://github.com/${parts.join('/')}`
  } catch (_) {
    return ''
  }
}

const normalizeBranchName = (value) => {
  if (typeof value !== 'string') return ''
  const branch = value.trim()
  if (!branch || /[\0\r\n]/.test(branch)) return ''
  return branch
}

const getGithubCommitSource = (theme) => {
  if (!theme || typeof theme.url !== 'string' || !theme.url.trim()) return null

  try {
    const parsed = new URL(theme.url.trim())
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return null
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null

    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    if (parts.length > 2 && parts[2] !== 'tree') return null

    const owner = parts[0]
    const repo = parts[1].replace(/\.git$/i, '')
    if (!SAFE_GITHUB_PART.test(owner) || !SAFE_GITHUB_PART.test(repo)) return null

    const branch = normalizeBranchName(theme.branch) ||
      (parts[2] === 'tree' && parts.length === 4 ? normalizeBranchName(parts[3]) : '')
    if (!branch) return null

    return {
      owner,
      repo,
      branch,
      repoUrl: `https://github.com/${owner}/${repo}`
    }
  } catch (_) {
    return null
  }
}

const getCommitDate = (commit) => {
  const value = commit?.commit?.author?.date || commit?.commit?.committer?.date || ''
  if (typeof value !== 'string') return ''
  return value.split('T')[0] || ''
}

const getCommitSummary = (commit) => {
  const message = commit?.commit?.message
  if (typeof message !== 'string') return ''
  return message.split('\n')[0].trim()
}

const buildCommitVersion = (repoUrl, commit) => {
  const sha = typeof commit?.sha === 'string' ? commit.sha.trim() : ''
  if (!/^[a-f0-9]{40}$/i.test(sha)) return null

  const releaseDate = getCommitDate(commit)
  const summary = getCommitSummary(commit) || `commit ${sha.slice(0, 7)}`
  const title = releaseDate ? `${summary} to ${releaseDate}` : summary

  return {
    short_version: sha.slice(0, 7),
    title,
    releaseDate,
    changelog: summary,
    commitId: sha,
    theme_url: `${repoUrl}/tree/${sha}`
  }
}

const fetchThemeCommitVersions = async (theme) => {
  const source = getGithubCommitSource(theme)
  if (!source) return { versions: [], failed: false }

  try {
    const apiUrl = new URL(`https://api.github.com/repos/${source.owner}/${source.repo}/commits`)
    apiUrl.searchParams.set('sha', source.branch)
    apiUrl.searchParams.set('per_page', String(COMMIT_LIMIT))

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(apiUrl.href, { signal: controller.signal })
      if (!res.ok) return { versions: [], failed: true }

      const commits = await res.json()
      if (!Array.isArray(commits)) return { versions: [], failed: true }

      const versions = commits
        .map(commit => buildCommitVersion(source.repoUrl, commit))
        .filter(Boolean)

      return { versions, failed: versions.length === 0 }
    } finally {
      clearTimeout(timeout)
    }
  } catch (_) {
    return { versions: [], failed: true }
  }
}

const getThemeVersionKey = (theme) => {
  return String(theme?.id || theme?.url || theme?.title || '')
}

const isThemeVersionsLoading = (theme) => {
  return !!loadingVersions[getThemeVersionKey(theme)]
}

const canLoadThemeVersions = (theme) => {
  return !(theme?.versions && theme.versions.length > 0) && !!getGithubCommitSource(theme)
}

const updateThemeVersions = (theme, versions) => {
  const index = themes.value.findIndex(item => item === theme || (theme?.id && item.id === theme.id))
  if (index < 0) return

  const nextThemes = [...themes.value]
  nextThemes[index] = {
    ...nextThemes[index],
    versions
  }
  themes.value = nextThemes

  if (nextThemes[index].id) {
    selectedVersions[nextThemes[index].id] = 0
  }
}

const loadThemeVersions = async (theme) => {
  if (!canLoadThemeVersions(theme)) return

  const key = getThemeVersionKey(theme)
  if (!key || loadingVersions[key]) return

  loadingVersions[key] = true
  try {
    const result = await fetchThemeCommitVersions(theme)
    if (result.failed || !result.versions.length) {
      showThemeMessage(getThemeStoreNetworkError())
      return
    }

    updateThemeVersions(theme, result.versions)
  } finally {
    loadingVersions[key] = false
  }
}

const getGithubRepoParts = (theme) => {
  const url = getSafeExternalUrl(theme?.url)
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'github.com') return null
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
    if (!owner || !repo) return null
    return { owner, repo: repo.replace(/\.git$/i, '') }
  } catch (_) {
    return null
  }
}

const getVersionThemeUrl = (theme, version) => {
  const directUrl = normalizeThemeStoreUrl(
    version?.theme_url || ''
  )
  if (directUrl) return directUrl

  const repo = getGithubRepoParts(theme)
  const commitSha = String(version?.commitId || '').trim()
  if (repo && /^[a-f0-9]{40}$/i.test(commitSha)) {
    return `https://github.com/${repo.owner}/${repo.repo}/tree/${commitSha}`
  }

  return ''
}

const getSelectedThemeUrl = (theme) => {
  return getVersionThemeUrl(theme, getSelectedVersion(theme))
}

const isCurrentTheme = (theme) => {
  return props.currentThemeUrl && props.currentThemeUrl === getSelectedThemeUrl(theme)
}

const previewThemeUrl = async (themeUrl, previewingId) => {
  if (!themeUrl) {
    return
  }

  if (previewingThemeId.value) return
  previewingThemeId.value = previewingId
  try {
    const result = await adminApi({
      action: 'start_theme_preview',
      theme_url: themeUrl
    }, props.selectedApiIndex)

    if (result.error) {
      showThemeMessage(props.trans[result.error] || result.error || props.trans.themeApplyFailed)
      return
    }

    const previewUrl = result.data?.preview_url
    if (!previewUrl) {
      showThemeMessage(props.trans.themeApplyFailed)
      return
    }

    window.open(previewUrl, '_blank', 'noopener,noreferrer')
  } catch (e) {
    showThemeMessage(e.message || props.trans.themeApplyFailed)
  } finally {
    previewingThemeId.value = ''
  }
}

const previewTheme = async (theme) => {
  await previewThemeUrl(getSelectedThemeUrl(theme), theme.id)
}

const getCustomThemeUrl = () => {
  return normalizeThemeStoreUrl(customThemeUrl.value)
}

const previewCustomTheme = async () => {
  const themeUrl = getCustomThemeUrl()
  if (!themeUrl) {
    showThemeMessage(props.trans.invalidThemeUrl)
    return
  }
  customThemeUrl.value = themeUrl
  await previewThemeUrl(themeUrl, '__custom__')
}

const saveThemeUrl = async (themeUrl, applyingId) => {
  if (applyingThemeId.value) return

  applyingThemeId.value = applyingId
  try {
    const themeOptions = parseThemeOptionsJson()
    delete themeOptions.mikus

    const result = await adminApi({
      action: 'save_settings',
      settings: {
        ...buildAppearanceSettings(themeOptions),
        theme_url: themeUrl
      }
    }, props.selectedApiIndex)

    if (result.error) {
      showThemeMessage(props.trans[result.error] || result.error || props.trans.themeApplyFailed)
      return
    }

    emit('theme-applied', themeUrl)
    emit('theme-options-applied', themeOptions)
    showThemeMessage(props.trans.themeApplied)
  } catch (e) {
    showThemeMessage(e.message || props.trans.themeApplyFailed)
  } finally {
    applyingThemeId.value = ''
  }
}

const saveMikusTheme = async (enabled, applyingId) => {
  if (applyingThemeId.value) return

  applyingThemeId.value = applyingId
  try {
    const themeOptions = parseThemeOptionsJson()
    if (enabled) {
      themeOptions.mikus = 1
    } else {
      delete themeOptions.mikus
    }

    const result = await adminApi({
      action: 'save_settings',
      settings: {
        ...buildAppearanceSettings(themeOptions),
        theme_url: ''
      }
    }, props.selectedApiIndex)

    if (result.error) {
      showThemeMessage(props.trans[result.error] || result.error || props.trans.themeApplyFailed)
      return
    }

    emit('theme-applied', '')
    emit('theme-options-applied', themeOptions)
    showThemeMessage(props.trans.themeApplied)
  } catch (e) {
    showThemeMessage(e.message || props.trans.themeApplyFailed)
  } finally {
    applyingThemeId.value = ''
  }
}

const enableMikusTheme = async () => {
  if (isMikusThemeActive.value) return
  await saveMikusTheme(true, '__mikus_enable__')
}

const disableMikusTheme = async () => {
  if (!isMikusThemeActive.value) return
  await saveMikusTheme(false, '__mikus_disable__')
}

const applyTheme = async (theme) => {
  const themeUrl = getSelectedThemeUrl(theme)
  if (!themeUrl) {
    return
  }
  await saveThemeUrl(themeUrl, theme.id)
}

const applyCustomTheme = async () => {
  const themeUrl = getCustomThemeUrl()
  if (!themeUrl) {
    showThemeMessage(props.trans.invalidThemeUrl)
    return
  }
  customThemeUrl.value = themeUrl
  await saveThemeUrl(themeUrl, '__custom__')
}

const clearTheme = async () => {
  await saveThemeUrl('', '__builtin__')
}

const getThemeDescription = (theme) => {
  const description = theme?.description
  if (!description || typeof description !== 'object' || Array.isArray(description)) {
    return ''
  }

  const keys = currentLang.value === 'zh'
    ? ['zh-CN', 'en']
    : [currentLang.value, 'en', 'zh-CN']

  for (const key of keys) {
    if (typeof description[key] === 'string' && description[key].trim()) {
      return description[key]
    }
  }

  return Object.values(description).find(value => typeof value === 'string' && value.trim()) || ''
}

const getSafeExternalUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }

  try {
    const url = new URL(value.trim())
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch (_) {
    return ''
  }
}

const handleCoverError = (e) => {
  e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225"><rect fill="%231a1a2e" width="400" height="225"/><text fill="%23666" font-family="monospace" font-size="16" x="200" y="112" text-anchor="middle">No Preview</text></svg>'
}

watch(
  () => props.activeTab,
  (activeTab) => {
    if (activeTab === 'themeStore' && !loaded.value) {
      loadThemes()
    }
  },
  { immediate: true }
)

watch(
  () => props.currentThemeUrl,
  (themeUrl) => {
    customThemeUrl.value = themeUrl || ''
  },
  { immediate: true }
)
</script>

<style scoped>
.theme-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
}

.theme-store-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-card);
}

.theme-custom {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-card);
}

.theme-custom-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.theme-custom-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.theme-custom-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-word;
}

.theme-custom-form {
  display: flex;
  gap: 8px;
  align-items: center;
}

.theme-custom-form .form-input {
  flex: 1;
  min-width: 180px;
}

@media (max-width: 720px) {
  .theme-store-toolbar,
  .theme-custom-form {
    align-items: stretch;
    flex-direction: column;
  }

  .theme-custom-form .btn {
    width: 100%;
  }
}

.theme-current {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.theme-current-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.theme-current-value {
  font-size: 12px;
  color: var(--text-primary);
  font-family: var(--terminal-font);
  word-break: break-all;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.theme-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.theme-card:hover {
  border-color: var(--accent-green);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

.theme-card.active {
  border-color: var(--accent-green);
}

.theme-space {
  flex: 1;
}

.theme-cover-wrap {
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--bg-secondary, #1a1a2e);
}

.theme-cover-wrap-mikus {
  background: linear-gradient(135deg, rgba(255, 183, 197, 0.18), rgba(77, 166, 255, 0.12));
}

.theme-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.theme-cover-mikus {
  object-fit: contain;
  padding: 14px;
}

.theme-info {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  flex: 1;
}

.theme-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.theme-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.theme-version {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-hover, rgba(255,255,255,0.05));
  padding: 2px 6px;
  border-radius: 3px;
  font-family: var(--terminal-font);
}

.theme-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.theme-tag {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--accent-green);
  color: var(--color-inherit, #fff);
  border-radius: 3px;
  font-family: var(--terminal-font);
  opacity: 0.85;
}

.theme-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 8px 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.theme-author {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 10px;
  opacity: 0.7;
}

.theme-version-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.version-label {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.version-select {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  padding: 4px 8px;
  background: var(--bg-secondary, #1a1a2e);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  color: var(--text-primary);
  font-family: var(--terminal-font);
  cursor: pointer;
}

.version-select:focus {
  outline: none;
  border-color: var(--accent-green);
}

.version-load-btn {
  width: 100%;
}

.theme-version-info {
  margin-bottom: 10px;
  padding: 6px 8px;
  background: var(--bg-hover, rgba(255,255,255,0.03));
  border-radius: 3px;
}

.version-date {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.version-changelog {
  font-size: 11px;
}

.changelog-label {
  color: var(--accent-green);
  font-weight: 500;
  margin-bottom: 2px;
}

.changelog-content {
  color: var(--text-secondary);
  line-height: 1.4;
}

.theme-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.theme-actions .btn {
  flex: 1 1 90px;
  text-align: center;
  text-decoration: none;
  font-size: 12px;
  padding: 6px 12px;
}
</style>
