export function formatDate(dateStr, options = {}) {
  if (!dateStr) return '-'
  
  let date
  if (typeof dateStr === 'number') {
    date = new Date(dateStr * 1000)
  } else if (dateStr.includes('+') || dateStr.endsWith('Z')) {
    date = new Date(dateStr)
  } else {
    date = new Date(dateStr + 'Z')
  }
  
  if (isNaN(date.getTime())) return '-'
  
  return date.toLocaleString('it-IT', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Rome',
    ...options
  })
}

export function formatTime(dateStr) {
  if (!dateStr) return '-'
  
  let date
  if (typeof dateStr === 'number') {
    date = new Date(dateStr * 1000)
  } else if (dateStr.includes('+') || dateStr.endsWith('Z')) {
    date = new Date(dateStr)
  } else {
    date = new Date(dateStr + 'Z')
  }
  
  if (isNaN(date.getTime())) return '-'
  
  return date.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome'
  })
}

export function formatRelative(dateStr) {
  if (!dateStr) return '-'
  
  let date
  if (typeof dateStr === 'number') {
    date = new Date(dateStr * 1000)
  } else if (dateStr.includes('+') || dateStr.endsWith('Z')) {
    date = new Date(dateStr)
  } else {
    date = new Date(dateStr + 'Z')
  }
  
  if (isNaN(date.getTime())) return '-'
  
  const now = new Date()
  const diff = now - date
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (seconds < 60) return 'Adesso'
  if (minutes < 60) return `${minutes}m fa`
  if (hours < 24) return `${hours}h fa`
  if (days < 7) return `${days}g fa`
  
  return formatDate(date, { year: 'numeric', month: '2-digit', day: '2-digit' })
}