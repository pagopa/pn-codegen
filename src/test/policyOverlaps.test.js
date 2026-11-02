const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildPolicies } = require('../lib/policyGenerator')

const operation = types => ({ 'x-pn-allowed-cx-types': types })
const prefix = 'arn:aws:execute-api:{region}:{awsAccountId}:{restApiId}/{stage}'
const verbs = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']
const matches = (pattern, value) => new RegExp('^' + pattern.split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(value)
function isAllowed(policy, method, path) {
    const request = `${prefix}/${method}${path}`
    const statements = policy?.policyDocument.Statement || []
    return statements.some(s => s.Effect === 'Allow' && s.Resource.some(r => matches(r, request))) &&
        !statements.some(s => s.Effect === 'Deny' && s.Resource.some(r => matches(r, request)))
}

test('partial parameter intersections respect the more specific static route', () => {
    const policies = buildPolicies([{ paths: {
        '/a/{id}/c': { get: operation(['PA']) },
        '/a/b/{name}': { get: operation(['PF']) }
    } }])
    assert.equal(isAllowed(policies.PA, 'GET', '/a/b/c'), false)
    assert.equal(isAllowed(policies.PA, 'GET', '/a/x/c'), true)
    assert.equal(isAllowed(policies.PF, 'GET', '/a/b/c'), true)
    assert.equal(isAllowed(policies.PF, 'GET', '/a/b/x'), true)
})

test('rejects a partial-overlap deny that would block an allowed descendant', () => {
    assert.throws(() => buildPolicies([{ paths: {
        '/a/{id}/c': { get: operation(['PA']) },
        '/a/b/{name}': { get: operation(['PF']) },
        '/a/b/{name}/private': { get: operation(['PA']) }
    } }]), /Cannot deny/)
})

test('safe static exclusions preserve generic routes regardless of document order', () => {
    const generic = { paths: { '/items/{id}': { get: operation(['PA']) } } }
    const specific = { paths: {
        '/items/admin': { get: operation(['PF']) },
        '/items/untagged': { get: {} }
    } }
    const first = buildPolicies([generic, specific])
    assert.deepEqual(first, buildPolicies([specific, generic]))
    assert.equal(isAllowed(first.PA, 'GET', '/items/123'), true)
    assert.equal(isAllowed(first.PA, 'GET', '/items/admin'), false)
    assert.equal(isAllowed(first.PA, 'GET', '/items/untagged'), false)
    assert.equal(isAllowed(first.PF, 'GET', '/items/admin'), true)
})

test('a descendant deny cannot invalidate a shorter legitimate parameter route', () => {
    const policies = buildPolicies([{ paths: {
        '/items/{id}': { get: operation(['PA']) },
        '/items/{id}/private': { get: operation(['PF']) }
    } }])
    assert.equal(isAllowed(policies.PA, 'GET', '/items/123'), true)
    assert.equal(isAllowed(policies.PA, 'GET', '/items/123/private'), false)
    assert.equal(isAllowed(policies.PF, 'GET', '/items/123/private'), true)
})

test('multiple static branches and parameter values are handled without a sample value', () => {
    const policies = buildPolicies([{ paths: {
        '/a/{id}/c': { get: operation(['PA']) },
        '/a/b/{name}': { get: operation(['PF']) },
        '/a/d/{name}': { get: {} }
    } }])
    for (const id of ['b', 'd', 'x', 'sample', '0']) {
        assert.equal(isAllowed(policies.PA, 'GET', `/a/${id}/c`), !['b', 'd'].includes(id))
    }
})

test('ANY expands into concrete verbs and cannot cross the method/path separator', () => {
    const policies = buildPolicies([{ paths: {
        '/public': { 'x-amazon-apigateway-any-method': operation(['PA']) },
        '/admin/public': { get: operation(['PF']) }
    } }])
    assert.deepEqual(policies.PA.policyDocument.Statement[0].Resource,
        verbs.map(method => `${prefix}/${method}/public`))
    for (const method of verbs) {
        assert.equal(isAllowed(policies.PA, method, '/public'), true)
        assert.equal(isAllowed(policies.PA, method, '/admin/public'), false)
    }
    assert.equal(isAllowed(policies.PF, 'GET', '/admin/public'), true)
})

test('explicit methods, including untagged methods, override ANY permissions', () => {
    const policies = buildPolicies([{ paths: { '/public': {
        'x-amazon-apigateway-any-method': operation(['PA']),
        get: operation(['PF']),
        post: {}
    } } }])
    assert.equal(isAllowed(policies.PA, 'GET', '/public'), false)
    assert.equal(isAllowed(policies.PA, 'POST', '/public'), false)
    assert.equal(isAllowed(policies.PA, 'PUT', '/public'), true)
    assert.equal(isAllowed(policies.PF, 'GET', '/public'), true)
    assert.equal(isAllowed(policies.PF, 'PUT', '/public'), false)
})

test('ANY overrides are resolved across documents and do not depend on order', () => {
    const fallback = { paths: { '/public': { 'x-amazon-apigateway-any-method': operation(['PA']) } } }
    const explicit = { paths: { '/public': { get: operation(['PF']), post: {} } } }
    const policies = buildPolicies([fallback, explicit])
    assert.deepEqual(policies, buildPolicies([explicit, fallback]))
    assert.equal(isAllowed(policies.PA, 'GET', '/public'), false)
    assert.equal(isAllowed(policies.PA, 'POST', '/public'), false)
    assert.equal(isAllowed(policies.PA, 'PUT', '/public'), true)
})

test('ANY with all fallback verbs overridden emits no unused type policy', () => {
    const policies = buildPolicies([{ paths: { '/public': {
        'x-amazon-apigateway-any-method': operation(['BS']),
        ...Object.fromEntries(verbs.map(method => [method.toLowerCase(), operation(['PA'])]))
    } } }])
    assert.deepEqual(Object.keys(policies), ['PA'])
})

test('static path precedence applies before method selection', () => {
    const policies = buildPolicies([{ paths: {
        '/items/{id}': { get: operation(['PA']) },
        '/items/admin': { post: operation(['PF']) }
    } }])
    assert.equal(isAllowed(policies.PF, 'POST', '/items/admin'), true)
    assert.equal(isAllowed(policies.PA, 'GET', '/items/other'), true)
})

test('greedy parameters cannot hide overlap with protected descendants', () => {
    const policies = buildPolicies([{ paths: {
        '/files/{proxy+}': { get: operation(['PA']) },
        '/files/admin/{id}': { get: operation(['PF']) }
    } }])
    assert.equal(isAllowed(policies.PA, 'GET', '/files/admin/123'), false)
    assert.equal(isAllowed(policies.PA, 'GET', '/files/other/123'), true)
    assert.equal(isAllowed(policies.PF, 'GET', '/files/admin/123'), true)
})

test('a later path suffix still detects partial overlap across multiple parameter values', () => {
    const paths = {
        '/a/{first}/{second}/end': { get: operation(['PA']) },
        '/a/static/{value}/{tail}': { get: operation(['PF']) }
    }
    const policies = buildPolicies([{ paths }])
    for (const value of ['x', 'other', '123', 'end']) {
        assert.equal(isAllowed(policies.PA, 'GET', `/a/static/${value}/end`), false)
        assert.equal(isAllowed(policies.PF, 'GET', `/a/static/${value}/end`), true)
        assert.equal(isAllowed(policies.PA, 'GET', `/a/other/${value}/end`), true)
    }
})

test('invalid input in a later document is still rejected before producing a set', () => {
    assert.throws(() => buildPolicies([
        { paths: { '/valid': { get: operation(['PA']) } } },
        { paths: { '/invalid': { get: operation(['UNKNOWN']) } } }
    ]), /Unknown cx_type/)
})
