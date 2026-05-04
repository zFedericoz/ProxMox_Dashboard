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

function TaskManagerChart({ title, icon, data, dataKey, color, unit = '%' }) {
  const currentValue = data.length > 0 ? data[data.length - 1][dataKey] : 0
  const avgValue = data.length > 0
    ? data.reduce((sum, d) => sum + (d[dataKey] || 0), 0) / data.length
    : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold" style={{ color }}>{currentValue.toFixed(1)}</span>
          <span className="text-xs text-gray-500">{unit}</span>
        </div>
      </CardHeader>
      <CardBody>
        <div className="flex justify-between text-xs text-gray-500 mb-2 px-1">
          <span>Media: {avgValue.toFixed(1)}{unit}</span>
          <span>Min: {data.length > 0 ? Math.min(...data.map(d => d[dataKey] || 0)).toFixed(1) : '0.0'}{unit}</span>
          <span>Max: {data.length > 0 ? Math.max(...data.map(d => d[dataKey] || 0)).toFixed(1) : '0.0'}{unit}</span>
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis 
                dataKey="time" 
                stroke="#374151" 
                fontSize={11} 
                tickLine={false}
                tick={({ x, y, payload }) => {
                  const idx = data.indexOf(payload)
                  if (idx % Math.max(1, Math.floor(data.length / 6)) !== 0) return null
                  return <text x={x} y={y} dy={16} textAnchor="middle" fill="#6b7280" fontSize={11}>{payload.value}</text>
                }}
              />
              <YAxis stroke="#374151" fontSize={11} domain={[0, 100]} tickLine={false} tickCount={5} />
              <Tooltip
                contentStyle={{ 
                  backgroundColor: '#111827', 
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
                labelStyle={{ color: '#f3f4f6', marginBottom: '4px' }}
                formatter={(value) => [`${value.toFixed(1)}${unit}`, title]}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                fill={`url(#gradient-${dataKey})`}
                name={title}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  )
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

  const [cpuHistory, setCpuHistory] = useState([])
  const [ramHistory, setRamHistory] = useState([])
  const [diskHistory, setDiskHistory] = useState([])
  const [selectedNode, setSelectedNode] = useState('')
  const [showNodeSelector, setShowNodeSelector] = useState(false)
  const lastUpdateRef = useRef(0)

  const handleMetricsUpdate = useCallback((data) => {
    if (!data) return
    const now = Date.now()
    if (now - lastUpdateRef.current < 5000) return
    lastUpdateRef.current = now
    
    const time = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    
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
    
    const cpuPoint = { time, value: cpu }
    const ramPoint = { time, value: mem }
    const diskPoint = { time, value: disk }
    
    setCpuHistory(prev => [...prev.slice(-59), cpuPoint])
    setRamHistory(prev => [...prev.slice(-59), ramPoint])
    setDiskHistory(prev => [...prev.slice(-59), diskPoint])
  }, [selectedNode])

  useEffect(() => {
    const unsubscribe = subscribe('metrics_update', handleMetricsUpdate)
    return unsubscribe
  }, [subscribe, handleMetricsUpdate])

<<<<<<< proxmoxAPI
=======
  useEffect(() => {
    setCpuHistory([])
    setRamHistory([])
    setDiskHistory([])
  }, [selectedNode])

  if (loading && !summary) return <LoadingSkeleton />

>>>>>>> main
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

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Monitoraggio {selectedNode || 'Cluster'}
        </h2>
        <button
          onClick={() => setShowNodeSelector(!showNodeSelector)}
          className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700"
        >
          {selectedNode ? `Nodo: ${selectedNode}` : 'Tutti i nodi'}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {showNodeSelector && (
        <div className="flex flex-wrap gap-2 bg-gray-900 border border-gray-800 rounded-lg p-3">
          <button
            onClick={() => setSelectedNode('')}
            className={`px-3 py-1 text-xs rounded-full ${!selectedNode ? 'bg-cyan-500 text-gray-900' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            Tutti
          </button>
          {nodes.map(node => (
            <button
              key={node.name}
              onClick={() => setSelectedNode(node.name)}
              className={`px-3 py-1 text-xs rounded-full ${selectedNode === node.name ? 'bg-cyan-500 text-gray-900' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {node.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TaskManagerChart
          title="CPU"
          icon={<Cpu size={16} className="text-cyan-400" />}
          data={cpuHistory}
          dataKey="value"
          color="#22d3ee"
        />
        <TaskManagerChart
          title="RAM"
          icon={<MemoryStick size={16} className="text-purple-400" />}
          data={ramHistory}
          dataKey="value"
          color="#a855f7"
        />
        <TaskManagerChart
          title="Disco"
          icon={<HardDrive size={16} className="text-green-400" />}
          data={diskHistory}
          dataKey="value"
          color="#22c55e"
        />
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
          <CardHeader>Alert Live</CardHeader>
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

      <Card>
        <CardHeader>Task Recenti</CardHeader>
        <CardBody className="p-0">
          {recentTasks.length === 0 ? (
            <div className="p-4 text-center text-gray-500">Nessun task recente</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {recentTasks.map((task, i) => (
                <div key={i} className="p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500 font-mono">{task.node}</span>
                    <StatusBadge status={task.status} />
                  </div>
                  <p className="text-sm text-gray-200 truncate">{task.type || 'task'}</p>
                  <p className="text-xs text-gray-500 mt-1">{new Date(task.starttime * 1000).toLocaleTimeString('it-IT')}</p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
