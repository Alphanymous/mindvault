import { useEffect, useState } from 'react'

export type Route =
  | { name: 'inbox' }
  | { name: 'library'; folder?: string; type?: string; tag?: string }
  | { name: 'graph'; focus?: string }
  | { name: 'item'; id: string }
  | { name: 'settings' }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const q = new URLSearchParams(query)
  const [head, ...rest] = path.split('/')
  switch (head) {
    case 'library':
      return { name: 'library', folder: q.get('folder') ?? undefined, type: q.get('type') ?? undefined, tag: q.get('tag') ?? undefined }
    case 'graph':
      return { name: 'graph', focus: q.get('focus') ?? undefined }
    case 'item':
      return rest[0] ? { name: 'item', id: rest[0] } : { name: 'inbox' }
    case 'settings':
      return { name: 'settings' }
    default:
      return { name: 'inbox' }
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'library': {
      const q = new URLSearchParams()
      if (route.folder) q.set('folder', route.folder)
      if (route.type) q.set('type', route.type)
      if (route.tag) q.set('tag', route.tag)
      const s = q.toString()
      return `#/library${s ? '?' + s : ''}`
    }
    case 'graph':
      return route.focus ? `#/graph?focus=${encodeURIComponent(route.focus)}` : '#/graph'
    case 'item':
      return `#/item/${route.id}`
    case 'settings':
      return '#/settings'
    default:
      return '#/inbox'
  }
}

export function go(route: Route) {
  location.hash = href(route)
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
