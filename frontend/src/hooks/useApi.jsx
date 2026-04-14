import { useState, useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'

const MAX_RETRIES = 2
const RETRY_DELAY = 500

const globalCache = new Map()
const CACHE_TTL = 10000

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  let lastError
  
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, options)
      
      if (response.status === 304) {
        return { success: true, data: globalCache.get(url), cached: true }
      }
      
      if (response.status === 401) {
        throw new Error('UNAUTHORIZED')
      }
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || `HTTP ${response.status}`)
      }
      
      const data = await response.json()
      
      if (options.method === 'GET' || !options.method) {
        globalCache.set(url, data)
        setTimeout(() => globalCache.delete(url), CACHE_TTL)
      }
      
      return { success: true, data }
    } catch (error) {
      lastError = error
      
      if (error.message === 'UNAUTHORIZED') {
        throw error
      }
      
      if (i < retries && error.message !== 'NetworkError') {
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
  
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(immediate)
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
    const cacheKey = buildUrl()
    const cached = globalCache.get(cacheKey)
    
    if (!force && cached && (now - lastFetchTimeRef.current) < staleTime && data) {
      return { success: true, data: cached, cached: true }
    }
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()
    
    if (showLoading && !cached) setLoading(true)
    setError(null)

    const headers = buildHeaders()
    const result = await fetchWithRetry(cacheKey, {
      headers,
      signal: abortControllerRef.current.signal
    })

    if (result.success) {
      if (!result.cached) {
        setData(result.data)
        lastFetchTimeRef.current = now
      }
    } else {
      if (result.error !== 'UNAUTHORIZED') {
        setError(result.error)
      }
    }

    if (showLoading) setLoading(false)
    return result
  }, [buildUrl, buildHeaders, staleTime, data])

  const mutate = useCallback(async (method = 'GET', body = null) => {
    setLoading(true)
    setError(null)

    const headers = buildHeaders()
    const fetchOptions = { method, headers }
    
    if (body) {
      fetchOptions.body = JSON.stringify(body)
    }

    const result = await fetchWithRetry(buildUrl(), fetchOptions)

    if (result.success) {
      setData(result.data)
      lastFetchTimeRef.current = Date.now()
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

    if (result.success) {
      setLoading(false)
      return { success: true, data: result.data }
    } else {
      if (result.error !== 'UNAUTHORIZED') {
        setError(result.error)
      }
      setLoading(false)
      return { success: false, error: result.error }
    }
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