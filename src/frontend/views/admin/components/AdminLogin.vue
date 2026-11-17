<template>
  <div id="login-overlay" class="login-overlay">
    <div class="login-container">
      <div class="login-header">
        <div class="login-icon">🔐</div>
        <h2 class="login-title">{{ trans.adminLogin }}</h2>
        <p class="login-subtitle">{{ trans.enterCredentials }}</p>
      </div>
      <form @submit.prevent="$emit('login')">
        <div v-if="isMultipleMode" class="login-form-group">
          <label class="login-label">{{ trans.apiEndpoint }}</label>
          <select :value="selectedApiIndex" class="login-input" @change="$emit('api-index-change', Number($event.target.value))">
            <option
              v-for="(base, index) in apiBases"
              :key="index"
              :value="index"
            >
              [{{ index }}] {{ base }}
            </option>
          </select>
        </div>
        <div class="login-form-group">
          <label class="login-label">{{ trans.username }}</label>
          <input type="text" name="username" autocomplete="username" v-model="loginForm.username" required class="login-input" placeholder="admin">
        </div>
        <div class="login-form-group last">
          <label class="login-label">{{ trans.password }}</label>
          <div class="password-input-wrapper">
            <input :type="passwordVisible.login ? 'text' : 'password'" name="password" autocomplete="current-password" v-model="loginForm.password" required class="login-input">
            <button type="button" class="password-toggle" @click="$emit('toggle-password', 'login')">
              {{ passwordVisible.login ? '🙈' : '👁️' }}
            </button>
          </div>
        </div>
        <div v-if="turnstileSiteKey && (turnstileLoginEnabled || (turnstileEnabled && !turnstileVerified))" class="login-form-group">
          <div id="admin-turnstile-container"></div>
        </div>
        <div v-if="loginError" id="login-error" class="login-error">{{ loginError }}</div>
        <button type="submit" class="login-btn">{{ loginLoading ? '⏳' : trans.login }}</button>
        <button type="button" class="login-btn passkey-login-btn" :disabled="loginLoading || !passkeyAvailable" @click="$emit('passkey-login')">{{ trans.passkeyLogin }}</button>
        <p v-if="!passkeyAvailable" class="passkey-login-hint">{{ trans.passkeySameOrigin }}</p>
      </form>
    </div>
    <Footer />
  </div>
</template>

<script setup>
import Footer from '../../../components/Footer.vue'

defineProps({
  trans: { type: Object, required: true },
  isMultipleMode: { type: Boolean, default: false },
  apiBases: { type: Array, default: () => [] },
  selectedApiIndex: { type: Number, default: 0 },
  loginForm: { type: Object, required: true },
  passwordVisible: { type: Object, required: true },
  loginError: { type: String, default: '' },
  loginLoading: { type: Boolean, default: false },
  passkeyAvailable: { type: Boolean, default: false },
  turnstileSiteKey: { type: String, default: '' },
  turnstileLoginEnabled: { type: Boolean, default: false },
  turnstileEnabled: { type: Boolean, default: false },
  turnstileVerified: { type: Boolean, default: false }
})

defineEmits(['login', 'passkey-login', 'toggle-password', 'api-index-change'])
</script>

<style scoped>
.passkey-login-btn { margin-top: 10px; background: transparent; color: inherit; border: 1px solid currentColor; }
.passkey-login-hint { margin: 8px 0 0; font-size: 0.85em; opacity: 0.75; }
</style>
