import { clsx } from 'clsx'
import {
  LayoutDashboard, Server, Monitor, Cpu, FileText, Activity,
  Bell, DollarSign, Database, HardDrive, Zap, Shield,
  ChevronLeft, ChevronRight, Settings, User, ActivitySquare
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const menuItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'nodes', label: 'Nodi Cluster', icon: Server },
  { id: 'clusterhealth', label: 'Cluster Health', icon: ActivitySquare },
  { id: 'resources', label: 'VM & Container', icon: Monitor },
  { id: 'services', label: 'Servizi', icon: Cpu },
  { id: 'logs', label: 'Log Real-time', icon: FileText },
  { id: 'activities', label: 'Attivita', icon: Activity },
  { id: 'alerts', label: 'Alert', icon: Bell },
]

const cloudItems = [
  { id: 'backup', label: 'Backup', icon: HardDrive },
  { id: 'budget', label: 'Budget & Costi', icon: DollarSign },
  { id: 'storage', label: 'Storage', icon: Database },
]

const adminItems = [
  { id: 'account', label: 'Il Mio Account', icon: User },
  { id: 'users', label: 'Gestione Utenti', icon: Shield },
  { id: 'settings', label: 'Impostazioni', icon: Settings },
]

export function Sidebar({ currentPage, onNavigate, collapsed, onToggleCollapse }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  
  return (
    <aside
      className={clsx(
        'h-full bg-gray-900 border-r border-gray-800 flex flex-col transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-cyan-400" />
            <span className="font-bold text-white">PWMO</span>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 py-4 overflow-y-auto scrollbar-thin">
        <div className="px-3 mb-2">
          {!collapsed && <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Dashboard</span>}
        </div>
        {menuItems.map(item => (
          <NavItem
            key={item.id}
            {...item}
            active={currentPage === item.id}
            collapsed={collapsed}
            onClick={() => onNavigate(item.id)}
          />
        ))}

        <div className="px-3 mt-6 mb-2">
          {!collapsed && <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Cloud</span>}
        </div>
        {cloudItems.map(item => (
          <NavItem
            key={item.id}
            {...item}
            active={currentPage === item.id}
            collapsed={collapsed}
            onClick={() => onNavigate(item.id)}
          />
        ))}

        {isAdmin && (
          <>
            <div className="px-3 mt-6 mb-2">
              {!collapsed && <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Amministrazione</span>}
            </div>
            {adminItems.map(item => (
              <NavItem
                key={item.id}
                {...item}
                active={currentPage === item.id}
                collapsed={collapsed}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-gray-800">
        {!collapsed ? (
          <div className="text-xs text-gray-500">
            <p>Proxmox Dashboard v1.0</p>
            <p className="mt-1">Shortcut: R=Refresh</p>
          </div>
        ) : (
          <div className="flex justify-center">
            <Zap className="w-5 h-5 text-cyan-400" />
          </div>
        )}
      </div>
    </aside>
  )
}

function NavItem({ id, label, icon: Icon, active, collapsed, onClick }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all',
        'hover:bg-gray-800/50',
        active ? 'text-cyan-400 bg-gray-800 border-l-2 border-cyan-500' : 'text-gray-400'
      )}
      title={collapsed ? label : undefined}
    >
      <Icon size={20} className="flex-shrink-0" />
      {!collapsed && <span className="text-sm font-medium truncate">{label}</span>}
    </button>
  )
}
