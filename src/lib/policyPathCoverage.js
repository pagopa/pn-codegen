const ANY_CHARACTER = Symbol('any character')
const SEGMENT_CHARACTER = Symbol('non-slash character')
const OTHER_CHARACTER = Symbol('all other characters')

const resourcePath = apiPath => apiPath.replace(/\{[^}]+\}/g, '*')

function compilePath(apiPath, resource, subtree = false) {
    const states = [{ epsilon: [], transitions: [] }]
    let current = 0
    const newState = () => states.push({ epsilon: [], transitions: [] }) - 1
    const literal = character => {
        const next = newState()
        states[current].transitions.push({ character, next })
        current = next
    }
    const repeat = (character, allowEmpty) => {
        const loop = newState()
        const end = newState()
        states[current].transitions.push({ character, next: loop })
        states[loop].transitions.push({ character, next: loop })
        states[loop].epsilon.push(end)
        if (allowEmpty) {
            states[current].epsilon.push(end)
        }
        current = end
    }
    if (resource) {
        for (const character of resourcePath(apiPath)) {
            if (character === '*') {
                repeat(ANY_CHARACTER, true)
            } else {
                literal(character)
            }
        }
    } else {
        for (const part of apiPath.split(/(\{[^}]+\})/g)) {
            if (part.startsWith('{') && part.endsWith('}')) {
                repeat(part.endsWith('+}') ? ANY_CHARACTER : SEGMENT_CHARACTER, false)
            } else {
                for (const character of part) {
                    literal(character)
                }
            }
        }
    }
    if (subtree) {
        const prefixEnd = current
        literal('/')
        repeat(ANY_CHARACTER, true)
        states[prefixEnd].epsilon.push(current)
    }
    return { states, end: current }
}

function closure(automaton, initial) {
    const result = new Set(initial)
    const pending = [...initial]
    for (let i = 0; i < pending.length; i++) {
        for (const next of automaton.states[pending[i]].epsilon) {
            if (!result.has(next)) {
                result.add(next)
                pending.push(next)
            }
        }
    }
    return [...result].sort((a, b) => a - b)
}

function advance(automaton, active, character) {
    const next = new Set()
    for (const state of active) {
        for (const transition of automaton.states[state].transitions) {
            if (transition.character === ANY_CHARACTER ||
                (transition.character === SEGMENT_CHARACTER && character !== '/') ||
                transition.character === character) {
                next.add(transition.next)
            }
        }
    }
    return closure(automaton, next)
}

function higherPriorityPrefix(first, second) {
    const rank = segment => /^\{[^}]+\}$/.test(segment) ? segment.endsWith('+}') ? 0 : 1 : 2
    const left = first.split('/')
    const right = second.split('/')
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
        const difference = rank(left[i]) - rank(right[i])
        if (difference !== 0) {
            return difference > 0 ? left.slice(0, i + 1).join('/') : undefined
        }
        if (rank(left[i]) === 2 && left[i] !== right[i]) {
            return undefined
        }
    }
    return undefined
}

// Search the product automaton: resource ∩ route minus all higher-priority routes.
// OTHER_CHARACTER is an equivalence class, not a sampled parameter value: every
// character not present as a literal has exactly the same transitions.
function intersects(resource, route, excluded, alphabet) {
    const automata = [resource, route, ...excluded]
    const initial = automata.map(automaton => closure(automaton, [0]))
    const key = active => active.map(states => states.join(',')).join(';')
    const pending = [initial]
    const visited = new Set([key(initial)])
    for (let i = 0; i < pending.length; i++) {
        const active = pending[i]
        if (active[0].includes(resource.end) && active[1].includes(route.end) &&
            excluded.every((automaton, index) => !active[index + 2].includes(automaton.end))) {
            return true
        }
        for (const character of alphabet) {
            const next = automata.map((automaton, index) => advance(automaton, active[index], character))
            if (next[0].length === 0 || next[1].length === 0) {
                continue
            }
            const nextKey = key(next)
            if (!visited.has(nextKey)) {
                visited.add(nextKey)
                pending.push(next)
            }
        }
    }
    return false
}

function createPathCoverage(apiPaths) {
    const paths = [...new Set(apiPaths)]
    const routes = new Map(paths.map(apiPath => [apiPath, compilePath(apiPath, false)]))
    const resources = new Map(paths.map(apiPath => [apiPath, compilePath(apiPath, true)]))
    const alphabet = new Set(['/', OTHER_CHARACTER])
    for (const automaton of routes.values()) {
        for (const state of automaton.states) {
            for (const { character } of state.transitions) {
                if (typeof character === 'string') {
                    alphabet.add(character)
                }
            }
        }
    }
    const branches = new Map()
    const excluded = new Map(paths.map(apiPath => {
        const prefixes = new Set(paths.map(other => higherPriorityPrefix(other, apiPath))
            .filter(prefix => prefix !== undefined))
        for (const prefix of prefixes) {
            if (!branches.has(prefix)) {
                // Routing selects the more specific branch before resolving its descendants.
                branches.set(prefix, compilePath(prefix, false, true))
            }
        }
        return [apiPath, [...prefixes].map(prefix => branches.get(prefix))]
    }))
    const cache = new Map()
    return (resourceRoute, servedRoute) => {
        if (resourceRoute.method !== servedRoute.method) {
            return false
        }
        const key = JSON.stringify([resourceRoute.apiPath, servedRoute.apiPath])
        if (!cache.has(key)) {
            cache.set(key, intersects(resources.get(resourceRoute.apiPath), routes.get(servedRoute.apiPath),
                excluded.get(servedRoute.apiPath), alphabet))
        }
        return cache.get(key)
    }
}

module.exports = { createPathCoverage, resourcePath }
