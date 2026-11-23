export const normalizeThemeOptions = (options) => {
  return options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {}
}

const MIKUS_ASSET_BASE = '/mikus'
const MIKUS_SAKURA_ID = 'mikus-global-sakura-background'
const MIKUS_SAKURA_COUNT = 15

const MIKUS_MOBILE_SAKURA_COUNT = 10

export const isThemeOptionEnabled = (options, key) => {
  const normalizedOptions = normalizeThemeOptions(options)
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, key)) return false

  const value = normalizedOptions[key]
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase()
    if (!normalizedValue) return false
    return !['0', 'false', 'off', 'no', 'disable', 'disabled'].includes(normalizedValue)
  }

  return true
}

export const isMikusThemeEnabled = (options) => isThemeOptionEnabled(options, 'mikus')

// 首页三网面板显示的线路条数：配置保存在 theme_options.three_net_panel_count，默认 3，0 表示隐藏面板，最多 8 条。
export const DEFAULT_THREE_NET_PANEL_COUNT = 3
export const MAX_THREE_NET_PANEL_COUNT = 8
export const MIN_THREE_NET_PANEL_COUNT = 0

export const getThreeNetPanelCount = (options) => {
  const value = Number(normalizeThemeOptions(options).three_net_panel_count)
  return Number.isInteger(value) && value >= MIN_THREE_NET_PANEL_COUNT && value <= MAX_THREE_NET_PANEL_COUNT
    ? value
    : DEFAULT_THREE_NET_PANEL_COUNT
}

// 内置风格配色：统一保存在 theme_options.color_preset，每个风格自带深/浅两套颜色。
export const CUSTOM_COLOR_MODES = ['dark', 'light']

const CUSTOM_COLOR_KEYS = [
  { key: 'accent_primary', cssVar: '--accent-green' },
  { key: 'accent_secondary', cssVar: '--accent-blue' },
  { key: 'bg_primary', cssVar: '--bg-primary' },
  { key: 'bg_card', cssVar: '--bg-card-solid' },
  { key: 'text_primary', cssVar: '--text-primary' },
  { key: 'border', cssVar: '--border-color' }
]

const CUSTOM_COLOR_STYLE_ID = 'cfsm-custom-colors'

// default 表示不覆盖内置配色，避免影响 Mikus 等主题。
export const COLOR_PRESETS = [
  {
    key: 'default',
    labelKey: 'colorPresetDefault',
    dark: { accent_primary: '#00d4aa', accent_secondary: '#4da6ff', bg_primary: '#0a0e14', bg_card: '#151b26', text_primary: '#d3dae3', border: '#1e2a3a' },
    light: { accent_primary: '#1a7f5a', accent_secondary: '#2563eb', bg_primary: '#f5f5f0', bg_card: '#fafaf5', text_primary: '#2c2c2c', border: '#d4d4c8' }
  },
  {
    key: 'ocean',
    labelKey: 'colorPresetOcean',
    dark: { accent_primary: '#38bdf8', accent_secondary: '#818cf8', bg_primary: '#08131f', bg_card: '#0f2033', text_primary: '#d9e8f7', border: '#1c3449' },
    light: { accent_primary: '#0369a1', accent_secondary: '#4f46e5', bg_primary: '#f0f6fb', bg_card: '#f9fcff', text_primary: '#173247', border: '#cfe1ef' }
  },
  {
    key: 'aurora',
    labelKey: 'colorPresetAurora',
    dark: { accent_primary: '#34d399', accent_secondary: '#6ee7b7', bg_primary: '#08130f', bg_card: '#0e231a', text_primary: '#d5f2e4', border: '#1a3b2c' },
    light: { accent_primary: '#047857', accent_secondary: '#0f766e', bg_primary: '#f0f8f4', bg_card: '#f9fdfa', text_primary: '#153a2b', border: '#cbe6d8' }
  },
  {
    key: 'nebula',
    labelKey: 'colorPresetNebula',
    dark: { accent_primary: '#c4b5fd', accent_secondary: '#f0abfc', bg_primary: '#0d0916', bg_card: '#1a1329', text_primary: '#e8dff7', border: '#2e2245' },
    light: { accent_primary: '#6d28d9', accent_secondary: '#be185d', bg_primary: '#f7f4fc', bg_card: '#fcfaff', text_primary: '#31204a', border: '#ded2ef' }
  },
  {
    key: 'sunset',
    labelKey: 'colorPresetSunset',
    dark: { accent_primary: '#fbbf24', accent_secondary: '#fb7185', bg_primary: '#150d08', bg_card: '#251811', text_primary: '#f7e6d6', border: '#3f2a1d' },
    light: { accent_primary: '#b45309', accent_secondary: '#be123c', bg_primary: '#fdf8f2', bg_card: '#fffcf8', text_primary: '#3d2818', border: '#ecdcc9' }
  },
  {
    key: 'sakura',
    labelKey: 'colorPresetSakura',
    dark: { accent_primary: '#f9a8d4', accent_secondary: '#a5b4fc', bg_primary: '#150b12', bg_card: '#261721', text_primary: '#f8e2ec', border: '#3f2432' },
    light: { accent_primary: '#be185d', accent_secondary: '#6d28d9', bg_primary: '#fdf5f9', bg_card: '#fffafc', text_primary: '#3d1f2e', border: '#f0d9e4' }
  },
  {
    key: 'forest',
    labelKey: 'colorPresetForest',
    dark: { accent_primary: '#a3e635', accent_secondary: '#22d3ee', bg_primary: '#0b1209', bg_card: '#162013', text_primary: '#dcefd1', border: '#2a3a22' },
    light: { accent_primary: '#3f6212', accent_secondary: '#0e7490', bg_primary: '#f5f9f0', bg_card: '#fbfdf8', text_primary: '#23331a', border: '#d8e5ca' }
  },
  {
    key: 'graphite',
    labelKey: 'colorPresetGraphite',
    dark: { accent_primary: '#94a3b8', accent_secondary: '#60a5fa', bg_primary: '#0d1014', bg_card: '#171c23', text_primary: '#dde3ea', border: '#2a323d' },
    light: { accent_primary: '#475569', accent_secondary: '#1d4ed8', bg_primary: '#f4f5f7', bg_card: '#fafbfc', text_primary: '#242b33', border: '#d7dce3' }
  }
]

const PRESET_KEYS = new Set(COLOR_PRESETS.map((preset) => preset.key))

export const getColorPresetKey = (options) => {
  const key = normalizeThemeOptions(options).color_preset
  return PRESET_KEYS.has(key) ? key : 'default'
}

export const getColorPreset = (key) => COLOR_PRESETS.find((preset) => preset.key === key) || COLOR_PRESETS[0]

const hexToRgbChannels = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
].join(', ')

export const applyCustomColors = (options) => {
  if (typeof document === 'undefined' || !document.head) return

  const presetKey = getColorPresetKey(options)
  const buildDeclarations = (mode) => {
    if (presetKey === 'default') return ''
    const palette = getColorPreset(presetKey)[mode]
    const declarations = CUSTOM_COLOR_KEYS.map(({ key, cssVar }) => `    ${cssVar}: ${palette[key]} !important;`)
    declarations.push(`    --bg-card: rgba(${hexToRgbChannels(palette.bg_card)}, 0.6) !important;`)
    return declarations.join('\n')
  }

  let style = document.getElementById(CUSTOM_COLOR_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = CUSTOM_COLOR_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = [
    'body:not(.light) {',
    buildDeclarations('dark'),
    '}',
    'body.light {',
    buildDeclarations('light'),
    '}'
  ].join('\n')
}

export const getMikusAssetUrl = (filename) => {
  const normalizedFilename = String(filename || '').replace(/^\/+/, '')
  return `${MIKUS_ASSET_BASE}/${normalizedFilename}`
}

const ensureMikusSakuraBackground = () => {
  if (typeof document === 'undefined' || !document.body) return
  if (document.getElementById(MIKUS_SAKURA_ID)) return

  const background = document.createElement('div')
  background.id = MIKUS_SAKURA_ID
  background.className = 'mikus-global-sakura'
  background.setAttribute('aria-hidden', 'true')

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
  const sakuraCount = viewportWidth <= 768 ? MIKUS_MOBILE_SAKURA_COUNT : MIKUS_SAKURA_COUNT
  for (let index = 0; index < sakuraCount; index += 1) {
    const petal = document.createElement('span')
    petal.className = 'mikus-background-petal'
    background.appendChild(petal)
  }

  document.body.insertBefore(background, document.body.firstChild)
}

const removeMikusSakuraBackground = () => {
  if (typeof document === 'undefined') return
  document.getElementById(MIKUS_SAKURA_ID)?.remove()
}

export const setMikusThemeClass = (enabled) => {
  if (typeof document === 'undefined') return
  const shouldEnable = Boolean(enabled)
  document.body.classList.toggle('mikus-theme', shouldEnable)
  if (shouldEnable) {
    ensureMikusSakuraBackground()
  } else {
    removeMikusSakuraBackground()
  }
}

export const applyMikusThemeOptions = (options) => {
  setMikusThemeClass(isMikusThemeEnabled(options))
}
