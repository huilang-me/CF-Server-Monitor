<template>
  <div :class="{ light: currentTheme === 'light', dark: currentTheme === 'dark' }">
    <router-view />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'

const currentTheme = ref('dark')

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
  currentTheme.value = theme
}

const initTheme = () => {
  const saved = getPreferredTheme()
  currentTheme.value = saved
  applyTheme(saved)
}

onMounted(() => {
  initTheme()
})

defineExpose({ setTheme, getPreferredTheme })
</script>