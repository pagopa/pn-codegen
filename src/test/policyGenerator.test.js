const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildPolicies, generatePolicies, isPolicyGenerationEnabled, removeObsoletePolicies } = require('../lib/policyGenerator')

const prefix = 'arn:aws:execute-api:{region}:{awsAccountId}:{restApiId}/{stage}'
const operation = types => ({ 'x-pn-allowed-cx-types': types })
const resources = policy => policy.policyDocument.Statement[0].Resource

test('only types declared on operations produce policies, with exact resources and schema', () => {
    const policies = buildPolicies([{ paths: {
        '/v1/items/{id}/files/{file}': { get: operation(['PF', 'PA']), post: operation(['PA']) },
        '/v1/private': { get: {} },
        '/v1/empty': { get: operation([]) }
    } }])
    assert.deepEqual(Object.keys(policies), ['PA', 'PF'])
    assert.deepEqual(policies.PF, {
        principalId: 'user',
        policyDocument: {
            Version: '2012-10-17',
            Statement: [{
                Action: 'execute-api:Invoke',
                Effect: 'Allow',
                Resource: [`${prefix}/GET/v1/items/*/files/*`]
            }]
        },
        context: {}
    })
    assert.deepEqual(resources(policies.PA), [
        `${prefix}/GET/v1/items/*/files/*`, `${prefix}/POST/v1/items/*/files/*`
    ])
    assert.equal(policies.PT, undefined)
})

test('known types are discovered dynamically, including PT only when tagged', () => {
    const policies = buildPolicies([{ paths: { '/v1/test': { get: operation(['PT', 'BS', 'PG']) } } }])
    assert.deepEqual(Object.keys(policies), ['BS', 'PG', 'PT'])
})

test('metadata and untagged CORS are ignored; all HTTP methods and ANY are handled', () => {
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
    const pathItem = Object.fromEntries(methods.map(method => [method, operation(['PA'])]))
    pathItem.parameters = [{ name: 'id' }]
    pathItem.summary = 'metadata'
    pathItem['x-pn-allowed-cx-types'] = ['PF']
    pathItem['x-amazon-apigateway-any-method'] = operation(['BS'])
    const policies = buildPolicies([{ paths: { '/v1/test': pathItem, '/v1/cors': { options: {} } } }])
    assert.deepEqual(resources(policies.PA), methods.map(method => `${prefix}/${method.toUpperCase()}/v1/test`).sort())
    assert.equal(policies.BS, undefined)
    assert.equal(policies.PF, undefined)
})

test('resources are deduplicated and sorted independently of document and tag order', () => {
    const first = { paths: { '/z': { get: operation(['PF', 'PA', 'PF']) } } }
    const second = { paths: { '/a': { patch: operation(['PA']) }, '/z': { get: operation(['PA']) } } }
    const policies = buildPolicies([first, second])
    assert.deepEqual(policies, buildPolicies([second, first]))
    assert.deepEqual(resources(policies.PA), [`${prefix}/GET/z`, `${prefix}/PATCH/a`])
})

test('missing tags and empty paths produce no policies, not deny files', () => {
    assert.deepEqual(buildPolicies([{ paths: {} }, { paths: { '/test': { get: {}, post: operation([]) } } }]), {})
})

test('unknown types and malformed annotations fail explicitly', () => {
    for (const types of [['UNKNOWN'], ['pa'], ['__proto__'], [42], [null], 'PA', null, {}]) {
        assert.throws(() => buildPolicies([{ paths: { '/test': { get: operation(types) } } }]),
            /Unknown cx_type|must be an array/)
    }
    for (const doc of [null, {}, { paths: [] }, { paths: { invalid: {} } }, { paths: { '/test': { get: null } } }]) {
        assert.throws(() => buildPolicies([doc]), /OpenAPI|Invalid/)
    }
})

test('generatePolicies is strictly boolean, opt-in and incompatible with skipped AWS generation', () => {
    assert.equal(isPolicyGenerationEnabled({}), false)
    assert.equal(isPolicyGenerationEnabled({ generatePolicies: false, skipAWSGeneration: true }), false)
    assert.equal(isPolicyGenerationEnabled({ generatePolicies: true }), true)
    for (const value of ['true', 'false', 1, 0, null]) {
        assert.throws(() => isPolicyGenerationEnabled({ generatePolicies: value }), /must be a boolean/)
    }
    assert.throws(() => isPolicyGenerationEnabled({ generatePolicies: true, skipAWSGeneration: true }),
        /requires AWS OpenAPI generation/)
})

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-codegen-policies-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const file = path.join(dir, 'aws.yaml')
    const output = path.join(dir, 'generated')
    const write = types => fs.writeFileSync(file, JSON.stringify({
        paths: { '/v1/items/{id}': { get: operation(types) } }
    }))
    return { dir, file, output, write }
}

test('writes deterministic files, removes obsolete managed policies and preserves unrelated files', t => {
    const { file, output, write } = fixture(t)
    write(['PA', 'PF'])
    generatePolicies([file], output)
    const before = fs.readFileSync(path.join(output, 'paPolicy.json'), 'utf8')
    generatePolicies([file], output)
    assert.equal(fs.readFileSync(path.join(output, 'paPolicy.json'), 'utf8'), before)
    assert.ok(before.endsWith('\n'))
    fs.writeFileSync(path.join(output, 'notes.json'), 'preserve')
    fs.writeFileSync(path.join(output, 'ptPolicy.json'), 'obsolete')
    write(['PA'])
    generatePolicies([file], output)
    assert.deepEqual(fs.readdirSync(output).sort(), ['notes.json', 'paPolicy.json'])
    assert.equal(fs.readFileSync(path.join(output, 'notes.json'), 'utf8'), 'preserve')
    write([])
    generatePolicies([file], output)
    assert.deepEqual(fs.readdirSync(output), ['notes.json'])
})

test('validates all input documents before changing existing policies', t => {
    const { dir, file, output, write } = fixture(t)
    write(['PA'])
    generatePolicies([file], output)
    const before = fs.readFileSync(path.join(output, 'paPolicy.json'), 'utf8')
    write(['PF'])
    const invalid = path.join(dir, 'invalid.yaml')
    fs.writeFileSync(invalid, JSON.stringify({ paths: { '/invalid': { get: operation(['UNKNOWN']) } } }))
    assert.throws(() => generatePolicies([file, invalid], output), /Unknown cx_type/)
    assert.deepEqual(fs.readdirSync(output), ['paPolicy.json'])
    assert.equal(fs.readFileSync(path.join(output, 'paPolicy.json'), 'utf8'), before)
    fs.writeFileSync(invalid, 'paths: [')
    assert.throws(() => generatePolicies([invalid], output), /unexpected end/)
    assert.equal(fs.readFileSync(path.join(output, 'paPolicy.json'), 'utf8'), before)
    assert.throws(() => generatePolicies([], output), /at least one/)
})

test('invalid input terminates a Node process with a visible error and nonzero exit', t => {
    const { file, output, write } = fixture(t)
    write(['UNKNOWN'])
    const result = spawnSync(process.execPath, ['-e',
        'require(process.argv[1]).generatePolicies([process.argv[2]], process.argv[3])',
        require.resolve('../lib/policyGenerator'), file, output], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Unknown cx_type "UNKNOWN" on GET \/v1\/items/)
    assert.equal(fs.existsSync(output), false)
})

test('unsafe overlapping routes fail before changing previously generated policy files', t => {
    const { file, output, write } = fixture(t)
    write(['PA'])
    generatePolicies([file], output)
    const before = fs.readFileSync(path.join(output, 'paPolicy.json'), 'utf8')
    fs.writeFileSync(file, JSON.stringify({ paths: {
        '/a/{id}/c': { get: operation(['PA']) },
        '/a/b/{name}': { get: operation(['PF']) },
        '/a/b/{name}/private': { get: operation(['PA']) }
    } }))
    assert.throws(() => generatePolicies([file], output), /Cannot deny/)
    assert.deepEqual(fs.readdirSync(output), ['paPolicy.json'])
    assert.equal(fs.readFileSync(path.join(output, 'paPolicy.json'), 'utf8'), before)
})

test('explicit cleanup removes only generated policy files and preserves unrelated content', t => {
    const { file, output, write } = fixture(t)
    write(['PA', 'PG', 'PF', 'BS', 'PT'])
    generatePolicies([file], output)
    fs.writeFileSync(path.join(output, 'notes.json'), 'preserve')
    fs.mkdirSync(path.join(output, 'other'))
    fs.writeFileSync(path.join(output, 'other', 'paPolicy.json'), 'preserve nested file')
    removeObsoletePolicies(output)
    assert.deepEqual(fs.readdirSync(output).sort(), ['notes.json', 'other'])
    assert.equal(fs.readFileSync(path.join(output, 'notes.json'), 'utf8'), 'preserve')
    assert.equal(fs.readFileSync(path.join(output, 'other', 'paPolicy.json'), 'utf8'), 'preserve nested file')
    removeObsoletePolicies(output)
    assert.deepEqual(fs.readdirSync(output).sort(), ['notes.json', 'other'])
})

test('cleanup handles a missing directory without creating it', t => {
    const { output } = fixture(t)
    removeObsoletePolicies(output)
    assert.equal(fs.existsSync(output), false)
})

test('cleanup surfaces filesystem errors', t => {
    const { output } = fixture(t)
    fs.mkdirSync(path.join(output, 'paPolicy.json'), { recursive: true })
    assert.throws(() => removeObsoletePolicies(output), /EISDIR|EPERM/)
})
