import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'prompts' }
  | { name: 'clusters' }
  | { name: 'library'; folder?: string; type?: string; tag?: string; c?: string }
  | { name: 'graph'; focus?: string }
  | { name: 'item'; id: string; page?: number }
  | { name: 'settings'; tab?: string }
  | { name: 'pair'; token: string }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const q = new URLSearchParams(query)
  const [head, ...rest] = path.split('/')
  switch (head) {
    case 'inbox': // old links from earlier versions
      return { name: 'library', c: 'new' }
    case 'prompts':
      return { name: 'prompts' }
    case 'clusters':
      return { name: 'clusters' }
    case 'library':
      return { name: 'library', folder: q.get('folder') ?? undefined, type: q.get('type') ?? undefined, tag: q.get('tag') ?? undefined, c: q.get('c') ?? undefined }
    case 'graph':
      return { name: 'graph', focus: q.get('focus') ?? undefined }
    case 'item':
      return rest[0] ? { name: 'item', id: rest[0], page: Number(q.get('page')) > 0 ? Number(q.get('page')) : undefined } : { name: 'home' }
    case 'settings':
      return { name: 'settings', tab: q.get('tab') ?? undefined }
    case 'pair':
      return { name: 'pair', token: rest[0] ?? '' }
    default:
      return { name: 'home' }
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'library': {
      const q = new URLSearchParams()
      if (route.folder) q.set('folder', route.folder)
      if (route.type) q.set('type', route.type)
      if (route.tag) q.set('tag', route.tag)
      if (route.c) q.set('c', route.c)
      const s = q.toString()
      return `#/library${s ? '?' + s : ''}`
    }
    case 'graph':
      return route.focus ? `#/graph?focus=${encodeURIComponent(route.focus)}` : '#/graph'
    case 'item':
      return route.page ? `#/item/${route.id}?page=${route.page}` : `#/item/${route.id}`
    case 'settings':
      return route.tab ? `#/settings?tab=${route.tab}` : '#/settings'
    case 'pair':
      return `#/pair/${route.token}`
    case 'prompts':
      return '#/prompts'
    case 'clusters':
      return '#/clusters'
    default:
      return '#/home'
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
