import { useState, useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'

const MAX_RETRIES = 2
const RETRY_DELAY = 500
const FETCH_TIMEOUT = 25000

const globalCache = new Map()
const CACHE_TTL = 10000

// Normalize any URL (absolute or relative) to a consistent cache key
function normalizeCacheKey(url) {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    return parsed.pathname + parsed.search
  } catch {
    return url
  }
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  let lastError

  for (let i = 0; i <= retries; i++) {
    try {
      const providedSignal = options.signal

      // Bug 2 fix: use provided signal, but add timeout via a separate chain
      const controller = new AbortController()
      let signal = controller.signal

      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

      // If caller passed an AbortController signal, abort our controller when theirs fires too
      if (providedSignal) {
        const onAbort = () => controller.abort()
        providedSignal.addEventListener('abort', onAbort, { once: true })
        // Cleanup listener after fetch resolves or rejects
        signal = controller.signal
        signal._cleanup = () => providedSignal.removeEventListener('abort', onAbort)
      }

      const fetchOptions = {
        ...options,
        signal
      }

      const response = await fetch(url, fetchOptions)
      clearTimeout(timeoutId)
      if (signal._cleanup) signal._cleanup()

      if (response.status === 304) {
        const key = normalizeCacheKey(url)
        return { success: true, data: globalCache.get(key), cached: true }
      }

      if (response.status === 401) {
        throw new Error('UNAUTHORIZED')
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const detail =
          typeof data.detail === 'string'
            ? data.detail
            : data.detail
              ? JSON.stringify(data.detail)
              : null
        throw new Error(detail || `HTTP ${response.status}`)
      }

      const data = await response.json()

      if (options.method === 'GET' || !options.method) {
        // Bug 1 fix: normalize the cache key so useApi and useApiAction share the same bucket
        const key = normalizeCacheKey(url)
        globalCache.set(key, data)
        setTimeout(() => globalCache.delete(key), CACHE_TTL)
      }

      return { success: true, data }
    } catch (error) {
      lastError = error

      if (error.message === 'UNAUTHORIZED') {
        throw error
      }

      if (i < retries && error.name !== 'AbortError' && error.message !== 'NetworkError') {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)))
      }
    }
  }

  return { success: false, error: lastError.message }
}

export function useApi(endpoint, options = {}) {
  const { immediate = true, refetchInterval, params = {}, staleTime = 10000 } = options
  const { getAuthHeader } = useAuth()
  const abortControllerRef = useRef(null)
  const lastFetchTimeRef = useRef(0)

  // Bug 1 fix: normalize the cache key to match what fetchWithRetry uses
  const cacheKey = typeof endpoint === 'string' ? normalizeCacheKey(endpoint) : ''
  const initialData = cacheKey ? globalCache.get(cacheKey) || null : null

  const [data, setData] = useState(initialData)
  const dataRef = useRef(initialData)
  const [loading, setLoading] = useState(immediate && !initialData)
  const [error, setError] = useState(null)

  const buildUrl = useCallback(() => {
    const url = new URL(endpoint, window.location.origin)
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, value)
      }
    })
    return url.toString()
  }, [endpoint, params])

  const buildHeaders = useCallback(() => {
    const authHeader = getAuthHeader()
    return {
      'Content-Type': 'application/json',
      ...authHeader
    }
  }, [getAuthHeader])

  const fetchData = useCallback(async (showLoading = true, force = false) => {
    const now = Date.now()
    const url = buildUrl()
    const key = normalizeCacheKey(url)
    const cached = globalCache.get(key)

    // Fast path: serve cache even if local state is empty (e.g. first render)
    // Use dataRef instead of `data` state to avoid adding `data` to deps (→ infinite loop)
    if (!force && cached && (now - lastFetchTimeRef.current) < staleTime) {
      if (dataRef.current !== cached) {
        dataRef.current = cached
        setData(cached)
      }
      return { success: true, data: cached, cached: true }
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    // If we have cached data, don't show loading (show stale data while refreshing)
    if (showLoading && !cached) setLoading(true)
    setError(null)

    const headers = buildHeaders()
    const result = await fetchWithRetry(url, {
      headers,
      signal: abortControllerRef.current.signal
    })

    if (result.success) {
      // Keep state in sync even when server replies 304
      dataRef.current = result.data
      setData(result.data)
      lastFetchTimeRef.current = now
    } else {
      if (result.error !== 'UNAUTHORIZED') {
        setError(result.error)
      }
    }

    if (showLoading) setLoading(false)
    return result
  }, [buildUrl, buildHeaders, staleTime])

  const mutate = useCallback(async (method = 'GET', body = null) => {
    setLoading(true)
    setError(null)

    const headers = buildHeaders()
    const fetchOptions = { method, headers }

    if (body) {
      fetchOptions.body = JSON.stringify(body)
    }

    const url = buildUrl()
    const result = await fetchWithRetry(url, fetchOptions)

    if (result.success) {
      setData(result.data)
      lastFetchTimeRef.current = Date.now()
      // Any non-GET mutation should invalidate cached GET responses for this endpoint.
      if (method && method.toUpperCase() !== 'GET') {
        globalCache.delete(normalizeCacheKey(url))
      }
    } else {
      if (result.error !== 'UNAUTHORIZED') {
        setError(result.error)
      }
    }

    setLoading(false)
    return result
  }, [buildUrl, buildHeaders])

  useEffect(() => {
    if (immediate) {
      fetchData()
    }
  }, [immediate, fetchData])

  useEffect(() => {
    if (refetchInterval) {
      const interval = setInterval(() => fetchData(false), refetchInterval)
      return () => clearInterval(interval)
    }
  }, [refetchInterval, fetchData])

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  return { data, loading, error, refetch: () => fetchData(true, true), mutate }
}

export function useApiAction() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { getAuthHeader } = useAuth()
  const abortControllerRef = useRef(null)

  const execute = useCallback(async (endpoint, method = 'POST', body = null) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    setLoading(true)
    setError(null)

    const headers = {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    }

    const fetchOptions = {
      method,
      headers,
      signal: abortControllerRef.current.signal
    }

    if (body) {
      fetchOptions.body = JSON.stringify(body)
    }

    const result = await fetchWithRetry(endpoint, fetchOptions)

    // Bug 3 fix: on successful mutation, invalidate any matching useApi cache entries
    if (result.success && method && method.toUpperCase() !== 'GET') {
      const key = normalizeCacheKey(endpoint)
      // Delete exact match
      globalCache.delete(key)
      // Also invalidate any cached entries that start with the same base endpoint
      // (covers endpoints with query params that useApi may have cached)
      for (const cacheKey of globalCache.keys()) {
        if (cacheKey.startsWith(key.split('?')[0])) {
          globalCache.delete(cacheKey)
        }
      }
      setLoading(false)
      return { success: true, data: result.data }
    }

    if (result.success) {
      setLoading(false)
      return { success: true, data: result.data }
    }

    if (result.error !== 'UNAUTHORIZED') {
      setError(result.error)
    }
    setLoading(false)
    return { success: false, error: result.error }
  }, [getAuthHeader])

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  return { execute, loading, error, clearError: () => setError(null) }
}
