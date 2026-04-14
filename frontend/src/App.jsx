import { useState } from 'react'
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

const pages = {
  overview: Overview,
  nodes: Nodes,
  resources: Resources,
  services: Services,
  logs: Logs,
  activities: Activities,
  alerts: Alerts,
  backup: Backup,
  budget: Budget,
  storage: Storage,
  settings: Settings,
  account: Account,
  users: UserManagement,
  clusterhealth: ClusterHealth,
}

function AppContent() {
  const { isAuthenticated } = useAuth()
  const [currentPage, setCurrentPage] = useState('overview')

  if (!isAuthenticated) {
    return <LoginPage />
  }

  const PageComponent = pages[currentPage] || Overview

  return (
    <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
      <PageComponent />
    </Layout>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <WebSocketProvider>
          <AppContent />
        </WebSocketProvider>
      </AuthProvider>
    </ToastProvider>
  )
}
