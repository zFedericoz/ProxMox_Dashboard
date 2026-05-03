import { useState, useEffect, useRef, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import { useWebSocket } from '../hooks/useWebSocket'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { CardStat } from '../components/ui/Card'
import { Badge, StatusBadge } from '../components/ui/Badge'
import { 
  Server, Monitor, Container, Bell, AlertTriangle, Activity
} from 'lucide-react'
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

const fmt = {
  pct: (v) => `${(v||0).toFixed(1)}%`,
}

export function Overview() {
  const { data: summary } = useApi('/api/cluster/summary', { 
    refetchInterval: 30000,
    staleTime: 10000 
  })
  const { data: alerts } = useApi('/api/alerts', { 
    refetchInterval: 30000,
    staleTime: 15000 
  })
  const { data: tasks } = useApi('/api/tasks', { 
    refetchInterval: 30000,
    staleTime: 20000 
  })
  const { subscribe } = useWebSocket()

  const [metricsHistory, setMetricsHistory] = useState([])
  const [selectedNode, setSelectedNode] = useState('')
  const [showNodeSelector, setShowNodeSelector] = useState(false)
  const lastUpdateRef = useRef(0)

  const handleMetricsUpdate = useCallback((data) => {
    if (!data) return
    const now = Date.now()
    if (now - lastUpdateRef.current < 5000) return
    lastUpdateRef.current = now
    
    setMetricsHistory(prev => {
      const targetNode = selectedNode || 'cluster'
      let cpu = data.used_cpu_percent || 0
      let mem = data.used_mem_percent || 0
      let disk = data.used_disk_percent || 0
      
      if (selectedNode && data.nodes) {
        const node = data.nodes.find(n => n.name === selectedNode)
        if (node) {
          cpu = node.cpu_usage || 0
          mem = node.mem_percent || 0
          disk = node.disk_percent || 0
        }
      }
      
      const newPoint = {
        time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        cpu,
        mem,
        disk
      }
      return [...prev.slice(-29), newPoint]
    })
  }, [selectedNode])

  useEffect(() => {
    const unsubscribe = subscribe('metrics_update', handleMetricsUpdate)
    return unsubscribe
  }, [subscribe, handleMetricsUpdate])

  const nodes = summary?.nodes || []
  const liveAlerts = alerts?.live_alerts || []
  const recentTasks = (tasks?.tasks || []).slice(0, 8)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <CardStat
          label="Nodi Online"
          value={`${summary?.online_nodes || 0}/${nodes.length}`}
          icon={<Server size={18} />}
          color={summary?.online_nodes === nodes.length ? 'green' : 'yellow'}
        />
        <CardStat
          label="VM Attive"
          value={summary?.total_vms || 0}
          icon={<Monitor size={18} />}
          color="cyan"
        />
        <CardStat
          label="Container LXC"
          value={summary?.total_containers || 0}
          icon={<Container size={18} />}
          color="purple"
        />
        <CardStat
          label="Alert Attivi"
          value={(liveAlerts?.length || 0) + (alerts?.alerts?.length || 0)}
          icon={<Bell size={18} />}
          color={(liveAlerts?.length || 0) > 0 ? 'red' : 'green'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <span>Utilizzo Risorse {selectedNode || 'Cluster'} (30 min)</span>
              <button
                onClick={() => setShowNodeSelector(!showNodeSelector)}
                className="ml-auto text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                {selectedNode ? `Nodo: ${selectedNode}` : 'Tutti i nodi'}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </CardHeader>
            {showNodeSelector && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                <button
                  onClick={() => { setSelectedNode(''); setShowNodeSelector(false); }}
                  className={`px-3 py-1 text-xs rounded-full ${!selectedNode ? 'bg-cyan-500 text-gray-900' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                >
                  Tutti
                </button>
                {nodes.map(node => (
                  <button
                    key={node.name}
                    onClick={() => { setSelectedNode(node.name); setShowNodeSelector(false); }}
                    className={`px-3 py-1 text-xs rounded-full ${selectedNode === node.name ? 'bg-cyan-500 text-gray-900' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                  >
                    {node.name}
                  </button>
                ))}
              </div>
            )}
            <CardBody>
              <div className="h-64">
                {metricsHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metricsHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }}
                        labelStyle={{ color: '#f3f4f6' }}
                      />
                      <Area type="monotone" dataKey="cpu" stackId="1" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.6} name="CPU %" />
                      <Area type="monotone" dataKey="mem" stackId="1" stroke="#a855f7" fill="#a855f7" fillOpacity={0.4} name="RAM %" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-500">
                    Dati in caricamento...
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <span>Alert Live</span>
            {liveAlerts.length > 0 && (
              <Badge variant="danger">{liveAlerts.length}</Badge>
            )}
          </CardHeader>
          <CardBody className="p-0">
            {liveAlerts.length === 0 && (!alerts?.alerts || alerts.alerts.length === 0) ? (
              <div className="p-4 text-center text-green-400">
                <Activity size={24} className="mx-auto mb-2" />
                <p>Nessun alert attivo</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800 max-h-64 overflow-y-auto">
                {[...liveAlerts, ...(alerts?.alerts || [])].slice(0, 6).map((alert, i) => (
                  <div key={i} className="p-3 flex items-start gap-3 hover:bg-gray-800/50">
                    <AlertTriangle size={16} className={
                      alert.severity === 'critical' ? 'text-red-400 mt-0.5' :
                      alert.severity === 'warning' ? 'text-yellow-400 mt-0.5' : 'text-blue-400 mt-0.5'
                    } />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate">{alert.message || alert.msg}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{alert.node} · {new Date(alert.timestamp * 1000).toLocaleString('it-IT')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>Tutti i nodi</CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-gray-800">
              {nodes.map((node) => (
                <div key={node.name} className="p-4 hover:bg-gray-800/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${node.status === 'online' ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="font-medium text-white">{node.name}</span>
                      <StatusBadge status={node.status} />
                    </div>
                    <span className="text-xs text-gray-500">{node.host}</span>
                  </div>
                  {node.status === 'online' && (
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500 text-xs">CPU</p>
                        <p className="font-mono text-cyan-400">{fmt.pct(node.cpu_usage)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs">RAM</p>
                        <p className="font-mono text-purple-400">{fmt.pct(node.mem_percent)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs">Disco</p>
                        <p className="font-mono text-green-400">{fmt.pct(node.disk_percent)}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Task Recenti</CardHeader>
          <CardBody className="p-0">
            {recentTasks.length === 0 ? (
              <div className="p-4 text-center text-gray-500">Nessun task recente</div>
            ) : (
              <div className="divide-y divide-gray-800 max-h-80 overflow-y-auto">
                {recentTasks.map((task, i) => (
                  <div key={i} className="p-3 flex items-center justify-between hover:bg-gray-800/50">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 font-mono">{task.node}</span>
                      <span className="text-sm text-gray-200">{task.type || 'task'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={task.status} />
                      <span className="text-xs text-gray-500">{new Date(task.starttime * 1000).toLocaleTimeString('it-IT')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
