import { useMemo } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { AuthProvider } from './context/AuthContext'
import { WebSocketProvider } from './hooks/useWebSocket'
import { Layout } from './components/layout/Layout'
import { LoginPage } from './pages/LoginPage'
import { Overview } from './pages/Overview'
import { Nodes } from './pages/Nodes'
import { Resources } from './pages/Resources'
import { Services } from './pages/Services'
import { Logs } from './pages/Logs'
import { Activities } from './pages/Activities'
import { Alerts } from './pages/Alerts'
import { Backup } from './pages/Backup'
import { Budget } from './pages/Budget'
import { Storage } from './pages/Storage'
import { Settings } from './pages/Settings'
import { Account } from './pages/Account'
import { UserManagement } from './pages/UserManagement'
import { ClusterHealth } from './pages/ClusterHealth'
import { ToastProvider } from './components/ui/Toast'

const routes = [
  { id: 'overview', path: '/', element: <Overview /> },
  { id: 'nodes', path: '/nodes', element: <Nodes /> },
  { id: 'clusterhealth', path: '/cluster-health', element: <ClusterHealth /> },
  { id: 'resources', path: '/resources', element: <Resources /> },
  { id: 'services', path: '/services', element: <Services /> },
  { id: 'logs', path: '/logs', element: <Logs /> },
  { id: 'activities', path: '/activities', element: <Activities /> },
  { id: 'alerts', path: '/alerts', element: <Alerts /> },
  { id: 'backup', path: '/backup', element: <Backup /> },
  { id: 'budget', path: '/budget', element: <Budget /> },
  { id: 'storage', path: '/storage', element: <Storage /> },
  { id: 'settings', path: '/settings', element: <Settings /> },
  { id: 'account', path: '/account', element: <Account /> },
  { id: 'users', path: '/users', element: <UserManagement /> },
]

function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  // Wait for session storage to be read before deciding
  if (loading) return null

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}

function LoginRoute() {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  // Wait for session storage to be read before deciding
  if (loading) return null

  if (isAuthenticated) {
    const to = location.state?.from?.pathname || '/'
    return <Navigate to={to} replace />
  }

  return <LoginPage />
}

function LayoutRoute({ children }) {
  const location = useLocation()
  const navigate = useNavigate()

  const pathToId = useMemo(() => {
    const m = new Map()
    for (const r of routes) m.set(r.path, r.id)
    return m
  }, [])

  const idToPath = useMemo(() => {
    const m = new Map()
    for (const r of routes) m.set(r.id, r.path)
    return m
  }, [])

  const currentPage = pathToId.get(location.pathname) || 'overview'
  const onNavigate = (id) => navigate(idToPath.get(id) || '/', { replace: false })

  return (
    <Layout currentPage={currentPage} onNavigate={onNavigate}>
      {children}
    </Layout>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <WebSocketProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              {routes.map((r) => (
                <Route
                  key={r.path}
                  path={r.path}
                  element={
                    <RequireAuth>
                      <LayoutRoute>{r.element}</LayoutRoute>
                    </RequireAuth>
                  }
                />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </WebSocketProvider>
      </AuthProvider>
    </ToastProvider>
  )
}
