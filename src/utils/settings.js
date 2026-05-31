export async function loadSettings(db) {
  const defaults = {
    site_title: 'Cloudflare Server Monitor',
    admin_title: 'Admin Panel',
    custom_bg: '',
    custom_head: '',
    custom_script: '',
    is_public: 'true',
    show_price: 'true',
    show_expire: 'true',
    show_bw: 'true',
    show_tf: 'true',
    tg_notify: 'false',
    tg_bot_token: '',
    tg_chat_id: ''
  };

  try {
    const { results } = await db.prepare('SELECT * FROM settings').all();
    if (results && results.length > 0) {
      results.forEach(r => defaults[r.key] = r.value);
    }
  } catch (e) {
    console.error('加载设置失败:', e);
  }

  return defaults;
}