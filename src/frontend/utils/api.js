const API_BASE = window.location.origin

export const getAuthHeader = () => {
  const saved = localStorage.getItem('admin_credentials')
  if (!saved) return {}
  try {
    const creds = JSON.parse(saved)
    if (creds.username && creds.password) {
      const encoded = btoa(creds.username + ':' + creds.password)
      return { 'Authorization': 'Basic ' + encoded }
    }
  } catch (e) {
    return {}
  }
  return {}
}

export const isAdminLoggedIn = () => {
  return !!localStorage.getItem('admin_credentials')
}

export const formatBytes = (bytes) => {
  bytes = parseFloat(bytes) || 0
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export const fetchServers = async () => {
  const res = await fetch(`${API_BASE}/api/servers`, {
    headers: getAuthHeader()
  })
  if (res.status === 401) {
    window.location.href = '/admin'
    return null
  }
  if (!res.ok) throw new Error('Failed to fetch')
  return await res.json()
}

export const fetchServerDetail = async (id) => {
  const res = await fetch(`${API_BASE}/api/server?id=${id}`, {
    headers: getAuthHeader()
  })
  if (res.status === 401) {
    window.location.href = '/admin'
    return null
  }
  if (!res.ok) throw new Error('Failed to fetch')
  return await res.json()
}

export const fetchServerHistory = async (id, metric, hours) => {
  const res = await fetch(`${API_BASE}/api/history?id=${id}&metric=${metric}&hours=${hours}`, {
    headers: getAuthHeader()
  })
  if (res.status === 401) {
    window.location.href = '/admin'
    return []
  }
  if (!res.ok) return []
  return await res.json()
}

export const fetchAllHistory = async (id, hours) => {
  const res = await fetch(`${API_BASE}/api/history/all?id=${id}&hours=${hours}`, {
    headers: getAuthHeader()
  })
  if (res.status === 401) {
    window.location.href = '/admin'
    return null
  }
  if (!res.ok) return null
  return await res.json()
}

export const fetchAggHistory = async (id, hours) => {
  const res = await fetch(`${API_BASE}/api/history/agg?id=${id}&hours=${hours}`, {
    headers: getAuthHeader()
  })
  if (res.status === 401) {
    window.location.href = '/admin'
    return null
  }
  if (!res.ok) return null
  return await res.json()
}

export const adminApi = async (data) => {
  const res = await fetch(`${API_BASE}/admin/api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify(data)
  })
  return res
}

export const login = async (username, password) => {
  const encoded = btoa(username + ':' + password)
  const res = await fetch(`${API_BASE}/admin/api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + encoded
    },
    body: JSON.stringify({ action: 'get_settings' })
  })
  if (res.ok) {
    localStorage.setItem('admin_credentials', JSON.stringify({ username, password }))
  }
  return res
}

export const logout = () => {
  localStorage.removeItem('admin_credentials')
}

export const fetchConfig = async () => {
  const res = await fetch(`${API_BASE}/api/config`)
  if (!res.ok) return null
  return await res.json()
}