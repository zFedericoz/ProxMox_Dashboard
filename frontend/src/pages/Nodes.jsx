import { useApi } from '../hooks/useApi'
import { Card, CardHeader, CardBody, CardStat } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badge'
import { Server, Cpu, HardDrive, MemoryStick, Layers } from 'lucide-react'

const fmt = {
  bytes: (b) => {
    if (!b) return '0 B'
    const u = ['B','KB','MB','GB','TB']
    let i = 0
    while (b >= 1024 && i < u.length-1) { b /= 1024; i++ }
    return `${b.toFixed(1)} ${u[i]}`
  },
  pct: (v) => `${(v||0).toFixed(1)}%`,
}

export function Nodes() {
  const { data: summary } = useApi('/api/cluster/summary', {
    refetchInterval: 20000, staleTime: 10000
  })
  const { data: clustersData } = useApi('/api/clusters', {
    refetchInterval: 20000, staleTime: 10000
  })

  const allNodes = summary?.nodes || []
  const clusters = clustersData?.clusters || []
  const standaloneNodes = clustersData?.standalone_nodes || []

  const enriched = (nodes) =>
    nodes.map(n => ({ ...n, ...(allNodes.find(s => s.name === n.name) || {}) }))

  const calcStats = (nodes) => {
    const enrichedNodes = enriched(nodes)
    const online = enrichedNodes.filter(n => n.status === 'online')
    const cpuCores = online.reduce((s, n) => s + (n.cpu_cores || 0), 0)
    const memGb = online.reduce((s, n) => s + (n.mem_total_gb || 0), 0)
    const diskTb = online.reduce((s, n) => s + (n.disk_total_gb || 0), 0) / 1024
    const avgCpu = online.length ? (online.reduce((s, n) => s + (n.cpu_usage || 0), 0) / online.length) : 0
    const avgMem = online.length ? (online.reduce((s, n) => s + (n.mem_percent || 0), 0) / online.length) : 0
    const avgDisk = online.length ? (online.reduce((s, n) => s + (n.disk_percent || 0), 0) / online.length) : 0
    return { total: enrichedNodes.length, online: online.length, cpuCores, memGb, diskTb, avgCpu, avgMem, avgDisk }
  }

  return (
    <div className="space-y-6">
      {/* Per-cluster sections */}
      {clusters.map(c => {
        const liveNodes = enriched(c.nodes || [])
        const onlineCount = liveNodes.filter(n => n.status === 'online').length
        const stats = calcStats(c.nodes || [])

        return (
          <div key={c.id} className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <Layers size={16} className="text-cyan-400" />
              <h2 className="text-base font-semibold text-white">{c.name}</h2>
              {c.description && <span className="text-xs text-gray-500">{c.description}</span>}
            </div>

            {/* Cluster stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 ml-1">
              <CardStat label="CPU" value={`${stats.cpuCores} core`} icon={<Cpu size={18} />} color="cyan" />
              <CardStat label="RAM" value={`${stats.memGb.toFixed(1)} GB`} icon={<MemoryStick size={18} />} color="purple" />
              <CardStat label="Storage" value={`${stats.diskTb.toFixed(2)} TB`} icon={<HardDrive size={18} />} color="green" />
              <CardStat label="Nodi Online" value={`${stats.online}/${stats.total}`} icon={<Server size={18} />} color={stats.online === stats.total && stats.total > 0 ? 'green' : 'yellow'} />
            </div>

            {liveNodes.length === 0 ? (
              <div className="text-sm text-gray-500 px-2">Nessun nodo in questo cluster</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {liveNodes.map(node => <NodeCard key={node.name} node={node} />)}
              </div>
            )}
          </div>
        )
      })}

      {/* Standalone nodes */}
      {standaloneNodes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Server size={16} className="text-gray-400" />
            <h2 className="text-base font-semibold text-white">Standalone</h2>
            <span className="text-xs text-gray-500">nodi senza cluster</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {enriched(standaloneNodes).map(node => <NodeCard key={node.name} node={node} />)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {allNodes.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Server size={48} className="mx-auto mb-4 opacity-30" />
          <p>Nessun nodo configurato</p>
        </div>
      )}
    </div>
  )
}

function NodeCard({ node }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${node.status === 'online' ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="font-semibold text-white">{node.name}</span>
          <StatusBadge status={node.status} />
        </div>
        <span className="text-xs text-gray-500 font-mono">{node.host}</span>
      </CardHeader>
      <CardBody>
        {node.status === 'online' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <MetricBox label="CPU" value={fmt.pct(node.cpu_usage)} color="text-cyan-400" />
              <MetricBox label="RAM" value={fmt.pct(node.mem_percent)} color="text-purple-400" />
              <MetricBox label="Disco" value={fmt.pct(node.disk_percent)} color="text-green-400" />
            </div>
            <div className="space-y-2">
              <GaugeBar label="CPU" value={node.cpu_usage} />
              <GaugeBar label="RAM" value={node.mem_percent} />
              <GaugeBar label="Disco" value={node.disk_percent} />
            </div>
            <div className="pt-4 border-t border-gray-800 space-y-2 text-sm">
              <InfoRow label="Core" value={node.cpu_cores} />
              <InfoRow label="RAM" value={fmt.bytes((node.mem_total_gb || 0) * 1024**3)} />
              <InfoRow label="Disco" value={fmt.bytes((node.disk_total_gb || 0) * 1024**3)} />
              <InfoRow label="Uptime" value={node.uptime_str} />
              <InfoRow label="Load Avg" value={(node.load_avg || []).join(' / ')} />
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-red-400">
            <Server size={32} className="mx-auto mb-2 opacity-50" />
            <p>Nodo non raggiungibile</p>
            <p className="text-sm text-gray-500 mt-1">{node.error || 'Connessione fallita'}</p>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function MetricBox({ label, value, color }) {
  return (
    <div className="text-center p-2 bg-gray-800/50 rounded-lg">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono text-white">{value ?? 'N/A'}</span>
    </div>
  )
}

function GaugeBar({ label, value }) {
  const pct = Math.min(value || 0, 100)
  const color = pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-yellow-500' : 'bg-cyan-500'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className="font-mono text-white">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
