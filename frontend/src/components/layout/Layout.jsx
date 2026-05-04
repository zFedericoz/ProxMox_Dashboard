import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const pageTitles = {
  overview: 'Overview',
  nodes: 'Nodi Cluster',
  resources: 'VM & Container',
  services: 'Servizi di Sistema',
  logs: 'Log Real-time',
  activities: 'Attivita Recenti',
  alerts: 'Alert & Notifiche',
  backup: 'Backup & Snapshot',
  budget: 'Budget & Costi',
  storage: 'Storage',
  governance: 'Governance',
}

const pageComponents = {}

export function Layout({ children, currentPage, onNavigate }) {
  const [collapsed, setCollapsed] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
        handleRefresh()
      }
      if (e.key === '/') {
        e.preventDefault()
        document.querySelector('input[placeholder*="Cerca"]')?.focus()
      }
      const pageKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
      const pages = ['overview', 'nodes', 'resources', 'services', 'logs', 'activities', 'alerts', 'backup', 'budget']
      const idx = pageKeys.indexOf(e.key)
      if (idx !== -1 && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
        onNavigate(pages[idx])
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [handleRefresh, onNavigate])

  return (
    <div className="h-screen flex bg-gray-950">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          title={pageTitles[currentPage] || currentPage}
          onRefresh={handleRefresh}
        />
        <main className="flex-1 overflow-auto p-6 bg-gray-950">
          <div key={refreshKey}>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
