import { clsx } from 'clsx'

const variants = {
  success: 'bg-green-900/50 text-green-400 border-green-800',
  warning: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
  danger: 'bg-red-900/50 text-red-400 border-red-800',
  info: 'bg-blue-900/50 text-blue-400 border-blue-800',
  purple: 'bg-purple-900/50 text-purple-400 border-purple-800',
  gray: 'bg-gray-800/50 text-gray-400 border-gray-700',
}

const sizes = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
}

export function Badge({ children, variant = 'info', size = 'md', className, dot = false }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded-full font-medium border',
      variants[variant],
      sizes[size],
      className
    )}>
      {dot && (
        <span className={clsx(
          'w-1.5 h-1.5 rounded-full',
          variant === 'success' && 'bg-green-400',
          variant === 'warning' && 'bg-yellow-400',
          variant === 'danger' && 'bg-red-400',
          variant === 'info' && 'bg-blue-400',
          variant === 'purple' && 'bg-purple-400',
          variant === 'gray' && 'bg-gray-400',
        )} />
      )}
      {children}
    </span>
  )
}

export function StatusBadge({ status }) {
  const s = (status || '').toLowerCase()
  
  if (s === 'running' || s === 'online' || s === 'active' || s === 'enabled') {
    return <Badge variant="success" dot>{s}</Badge>
  }
  if (s === 'stopped' || s === 'offline' || s === 'disabled' || s === 'error') {
    return <Badge variant="danger" dot>{s}</Badge>
  }
  if (s === 'paused' || s === 'suspended' || s === 'warning') {
    return <Badge variant="warning" dot>{s}</Badge>
  }
  
  return <Badge variant="gray">{s || 'unknown'}</Badge>
}
