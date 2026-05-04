import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const WebSocketContext = createContext(null)

export function WebSocketProvider({ children }) {
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const wsRef = useRef(null)
  const listenersRef = useRef(new Map())
  const reconnectTimeoutRef = useRef(null)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 10
  const isIntentionalClose = useRef(false)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || 
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    
    try {
      wsRef.current = new WebSocket(wsUrl)

      wsRef.current.onopen = () => {
        setConnected(true)
        reconnectAttempts.current = 0
        console.log('WebSocket connected')
      }

      wsRef.current.onclose = () => {
        setConnected(false)
        if (!isIntentionalClose.current && reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current += 1
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
          reconnectTimeoutRef.current = setTimeout(() => connect(), delay)
        }
      }

      wsRef.current.onerror = (error) => {
        console.warn('WebSocket error:', error)
      }

      wsRef.current.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          setLastUpdate(new Date())
          
          listenersRef.current.forEach((callback, type) => {
            if (msg.type === type || type === '*') {
              callback(msg.data, msg)
            }
          })
        } catch (e) {
          console.error('WS parse error:', e)
        }
      }
    } catch (error) {
      console.error('WebSocket connection error:', error)
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current += 1
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
        reconnectTimeoutRef.current = setTimeout(() => connect(), delay)
      }
    }
  }, [])

  useEffect(() => {
    isIntentionalClose.current = false
    connect()
    
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send('ping')
        } catch (e) {
          console.warn('Failed to send ping:', e)
        }
      }
    }, 30000)

    return () => {
      isIntentionalClose.current = true
      clearInterval(pingInterval)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmount')
        wsRef.current = null
      }
    }
  }, [connect])

  const subscribe = useCallback((type, callback) => {
    listenersRef.current.set(type, callback)
    return () => listenersRef.current.delete(type)
  }, [])

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return (
    <WebSocketContext.Provider value={{ connected, lastUpdate, subscribe, send, reconnect: () => { 
      reconnectAttempts.current = 0
      connect() 
    } }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocket() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider')
  }
  return context
}
