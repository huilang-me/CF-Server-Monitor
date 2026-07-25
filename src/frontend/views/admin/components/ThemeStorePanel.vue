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

      <div v-else-if="themes.length === 0" class="warning-box mb-4">
        {{ trans.themeStoreEmpty }}
      </div>

      <div v-else class="theme-grid">
        <div v-for="theme in themes" :key="theme.id" class="theme-card">
          <div class="theme-cover-wrap">
            <img :src="theme.cover" :alt="theme.title" class="theme-cover" @error="handleCoverError" />
          </div>
          <div class="theme-info">
            <div class="theme-header">
              <h3 class="theme-title">{{ theme.title }}</h3>
              <span v-if="theme.version" class="theme-version">v{{ theme.version }}</span>
            </div>
            <div v-if="theme.tags && theme.tags.length" class="theme-tags">
              <span v-for="tag in theme.tags" :key="tag" class="theme-tag">{{ tag }}</span>
            </div>
            <p v-if="theme.description" class="theme-desc">{{ theme.description }}</p>
            <div v-if="theme.author" class="theme-author">by {{ theme.author }}</div>
            <div class="theme-actions">
              <button v-if="theme.preview" @click="openPreview(theme)" class="btn btn-sm">👁 {{ trans.preview }}</button>
              <a :href="theme.url" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-primary">↗ {{ trans.view }}</a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Preview Modal -->
    <div v-if="previewTheme" class="modal-overlay active" @click.self="previewTheme = null">
      <div class="modal-dialog modal-lg">
        <div class="modal-header">
          <div class="modal-title">{{ previewTheme.title }}</div>
          <button class="modal-close" @click="previewTheme = null">✕</button>
        </div>
        <div class="modal-body">
          <img :src="previewTheme.preview" :alt="previewTheme.title" class="theme-preview-img" @error="handlePreviewError" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import http from '../../../utils/http'

const props = defineProps({
  trans: { type: Object, required: true },
  activeTab: { type: String, default: 'themeStore' }
})

const themes = ref([])
const loading = ref(true)
const error = ref('')
const previewTheme = ref(null)

const loadThemes = async () => {
  loading.value = true
  error.value = ''
  try {
    const result = await http.get('/theme')
    if (result.error) throw new Error(result.error)
    themes.value = Array.isArray(result.data?.themes) ? result.data.themes : []
  } catch (e) {
    error.value = e.message || 'Failed to load themes'
  } finally {
    loading.value = false
  }
}

const openPreview = (theme) => {
  previewTheme.value = theme
}

const handleCoverError = (e) => {
  e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225"><rect fill="%231a1a2e" width="400" height="225"/><text fill="%23666" font-family="monospace" font-size="16" x="200" y="112" text-anchor="middle">No Preview</text></svg>'
}

const handlePreviewError = (e) => {
  e.target.style.display = 'none'
}

onMounted(() => {
  loadThemes()
})
</script>

<style scoped>
.theme-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.theme-card {
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

.theme-cover-wrap {
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--bg-secondary, #1a1a2e);
}

.theme-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.theme-info {
  padding: 12px 14px;
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

.theme-actions {
  display: flex;
  gap: 8px;
}

.theme-actions .btn {
  flex: 1;
  text-align: center;
  text-decoration: none;
  font-size: 12px;
  padding: 6px 12px;
}

.modal-lg .modal-body {
  padding: 0;
}

.theme-preview-img {
  width: 100%;
  display: block;
  border-radius: 0 0 6px 6px;
}
</style>
