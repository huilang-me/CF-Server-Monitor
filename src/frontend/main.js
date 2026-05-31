import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(router)
app.mount('#app').$nextTick(() => {
  const loading = document.getElementById('loading')
  if (loading) {
    setTimeout(() => {
      loading.remove()
    }, 1000)
  }
})