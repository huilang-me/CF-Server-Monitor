<template>
  <div class="terminal-header">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <div class="terminal-title">{{ title }}</div>
    <div class="terminal-header-controls">
      <div class="lang-toggle">
        <button 
          class="lang-btn" 
          :class="{ active: currentLang === 'en' }"
          @click="setLang('en')"
          title="English"
        >EN</button>
        <button 
          class="lang-btn" 
          :class="{ active: currentLang === 'zh' }"
          @click="setLang('zh')"
          title="中文"
        >中</button>
      </div>
      <div class="theme-toggle-wrapper">
        <!-- <span class="theme-label">{{ t('theme') }}:</span> -->
        <div class="theme-toggle">
          <button 
            class="theme-btn" 
            :class="{ active: currentTheme === 'auto' }"
            @click="setTheme('auto')"
            title="Auto - Follow System"
          >🌙☀</button>
          <button 
            class="theme-btn" 
            :class="{ active: currentTheme === 'dark' }"
            @click="setTheme('dark')"
            title="Dark Mode"
          >🌙</button>
          <button 
            class="theme-btn" 
            :class="{ active: currentTheme === 'light' }"
            @click="setTheme('light')"
            title="Light Mode"
          >☀</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { t, setLanguage, getLanguage } from '../utils/i18n'

defineProps({
  title: {
    type: String,
    default: 'Server Monitor'
  }
})

const currentTheme = ref('dark')
const currentLang = ref('en')

const getPreferredTheme = () => {
  return localStorage.getItem('theme_preference') || 'dark'
}

const setTheme = (theme) => {
  localStorage.setItem('theme_preference', theme)
  currentTheme.value = theme
  applyTheme(theme)
}

const applyTheme = (theme) => {
  if (theme === 'auto') {
    const hour = new Date().getHours()
    theme = (hour >= 6 && hour < 18) ? 'light' : 'dark'
  }
  document.body.classList.remove('dark', 'light')
  if (theme !== 'dark') {
    document.body.classList.add(theme)
  }
}

const setLang = (lang) => {
  setLanguage(lang)
  currentLang.value = lang
}

const handleLanguageChange = (e) => {
  currentLang.value = e.detail.lang
}

onMounted(() => {
  currentTheme.value = getPreferredTheme()
  applyTheme(currentTheme.value)
  currentLang.value = getLanguage()
  window.addEventListener('languageChanged', handleLanguageChange)
})

onUnmounted(() => {
  window.removeEventListener('languageChanged', handleLanguageChange)
})
</script>