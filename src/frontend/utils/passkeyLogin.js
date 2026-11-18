// Keep one short-lived challenge in memory. Never persist or poll for challenges;
// the server remains responsible for expiration and atomic single-use checks.
export function createPasskeyLoginOptions(fetchOptions, now = Date.now) {
  const maxAgeMs = 60_000
  let version = 0
  let pending = null
  let ready = null

  const clear = () => {
    version++
    ready = null
    pending = null
  }

  const take = () => {
    if (!ready) return null
    const value = ready
    clear()
    return value && now() - value.startedAt < maxAgeMs ? value.data : null
  }

  const prepare = () => {
    if (ready && now() - ready.startedAt < maxAgeMs) return Promise.resolve(ready.data)
    if (pending) return pending
    ready = null
    const context = version
    const startedAt = now()
    const operation = (async () => {
      const data = await fetchOptions()
      if (context !== version || now() - startedAt >= maxAgeMs) return null
      ready = { data, startedAt }
      return data
    })()
    pending = operation
    operation.finally(() => {
      if (context === version) pending = null
    }).catch(() => {})
    return operation
  }

  return { prepare, take, clear }
}
