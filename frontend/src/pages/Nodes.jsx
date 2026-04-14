import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, CardHeader, CardBody, CardStat } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badge'
import { Server, Cpu, HardDrive, MemoryStick, Clock, Activity } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const fmt = {
  bytes: (b) => {
    if (!b) return '0 B'
    const u = ['B','KB','MB','GB','TB']
    let i = 0
    while (b >= 1024 && i < u.length-1) { b /= 1024; i++ }
    return `${b.toFixed(1)} ${u[i]}`
  },
  pct: (v) => `${(v||0).toFixed(1)}%`,
  uptime: (s) => {
    if (!s) return 'N/A'
    const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60)
    if (d>0) return `${d}g ${h}h`
    if (h>0) return `${h}h ${m}m`
    return `${m}m`
  }
}

export function Nodes() {
  const { data: summary, loading } = useApi('/api/cluster/summary', { 
    refetchInterval: 20000,
    staleTime: 10000
  })
  
  const nodes = summary?.nodes || []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <CardStat label="CPU Totali" value={`${summary?.total_cpu_cores || 0} core`} icon={<Cpu size={18} />} color="cyan" />
        <CardStat label="RAM Totale" value={`${(summary?.total_mem_gb || 0).toFixed(1)} GB`} icon={<MemoryStick size={18} />} color="purple" />
        <CardStat label="Storage Totale" value={`${(summary?.total_disk_tb || 0).toFixed(2)} TB`} icon={<HardDrive size={18} />} color="green" />
        <CardStat label="Nodi Online" value={`${summary?.online_nodes || 0}/${nodes.length}`} icon={<Server size={18} />} color={summary?.online_nodes === nodes.length ? 'green' : 'yellow'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {nodes.map(node => (
          <Card key={node.name}>
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
                    <div className="text-center p-2 bg-gray-800/50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">CPU</p>
                      <p className="text-lg font-bold font-mono text-cyan-400">{fmt.pct(node.cpu_usage)}</p>
                    </div>
                    <div className="text-center p-2 bg-gray-800/50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">RAM</p>
                      <p className="text-lg font-bold font-mono text-purple-400">{fmt.pct(node.mem_percent)}</p>
                    </div>
                    <div className="text-center p-2 bg-gray-800/50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Disco</p>
                      <p className="text-lg font-bold font-mono text-green-400">{fmt.pct(node.disk_percent)}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <GaugeBar label="CPU" value={node.cpu_usage} />
                    <GaugeBar label="RAM" value={node.mem_percent} />
                    <GaugeBar label="Disco" value={node.disk_percent} />
                  </div>

                  <div className="pt-4 border-t border-gray-800 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Core</span>
                      <span className="font-mono text-white">{node.cpu_cores}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">RAM</span>
                      <span className="font-mono text-white">{fmt.bytes(node.mem_total_gb * 1024**3)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Disco</span>
                      <span className="font-mono text-white">{fmt.bytes(node.disk_total_gb * 1024**3)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Uptime</span>
                      <span className="font-mono text-white">{node.uptime_str}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Kernel</span>
                      <span className="font-mono text-gray-400 text-xs">{node.kernel || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Load Avg</span>
                      <span className="font-mono text-white">{(node.load_avg || []).join(' / ')}</span>
                    </div>
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
        ))}
      </div>
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
