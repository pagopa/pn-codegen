const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { createRequire } = require('module')
const yaml = require('js-yaml')
const generator = require('../lib/policyGenerator')
const { filterApiDocByPath, removePathPrefix } = require('../lib/yamlUtils')

const tagged = types => ({ 'x-pn-allowed-cx-types': types })
const rule = overrides => ({
    intendedUsage: 'WEB', servicePath: 'bff', openapiFiles: ['api-internal.yaml'],
    generatePolicies: true, ...overrides
})

function harness(config, { patch, cli = false } = {}) {
    const files = new Map([
        ['microsvc/codegen/config.json', JSON.stringify(config)],
        ['src/config/authorizer.json', '{}'],
        ['microsvc/docs/openapi/api-external.yaml', JSON.stringify({ paths: {
            '/bff/v1/items/{id}': { get: tagged(['PA']) },
            '/location/v1/public': { get: tagged(['PG']) }
        } })]
    ])
    const events = []
    const errors = []
    const fakeFs = {
        mkdirSync() {},
        readFileSync(file) {
            if (!files.has(file)) {
                throw new Error(`Missing test file ${file}`)
            }
            return files.get(file)
        },
        writeFileSync(file, content) { files.set(file, content) }
    }
    const transformer = Object.fromEntries([
        'internalToExternal', 'makeBundle', 'removeIntFormat', 'updateIntegerType', 'copyYamlFiles', 'lint'
    ].map(name => [name, async () => { events.push(name) }]))
    transformer.mergeYaml = async (input, output) => { files.set(output, files.get(input)) }
    transformer.applyPatch = async () => {
        events.push('patch')
        if (patch) {
            patch(files)
        }
    }
    const dependencies = {
        fs: fakeFs,
        './lib/httpClient': {},
        './lib/transformer': transformer,
        './lib/awsOpenApiBuilder': {
            buildAWSOpenApiFile: async (inputs, output) => {
                events.push(`aws:${output}`)
                const paths = Object.assign({}, ...inputs.map(input => yaml.load(files.get(input)).paths))
                files.set(output, yaml.dump({ paths }))
            }
        },
        './lib/bundleChecker': { checkBundles() {} },
        './lib/infra-tf/index': { terraformGenerator: async () => {} },
        './lib/policyGenerator': {
            ...generator,
            removeObsoletePolicies(output) {
                events.push('cleanup')
                harnessResult.cleanupOutput = output
            },
            generatePolicies(inputs, output) {
                events.push('policies')
                harnessResult.output = output
                harnessResult.policyInputs = [...inputs]
                harnessResult.policies = generator.buildPolicies(inputs.map(input => yaml.load(fakeFs.readFileSync(input))))
            }
        },
        './lib/yamlUtils': { filterApiDocByPath, removePathPrefix }
    }
    const module = { exports: {} }
    const sourceRequire = createRequire(path.join(__dirname, '../index.js'))
    const localRequire = name => Object.hasOwn(dependencies, name) ? dependencies[name] : sourceRequire(name)
    localRequire.main = cli ? module : {}
    const harnessResult = { files, events, errors, process: {}, module }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), {
        require: localRequire, module,
        console: { log() {}, debug() {}, error: (...args) => errors.push(args.map(String).join(' ')) },
        process: harnessResult.process
    }, { filename: 'index.js' })
    return harnessResult
}

test('enabled WEB rule uses generated, prefix-free AWS after patches; PUBLIC stays excluded', async () => {
    const awsFile = 'microsvc/docs/openapi/aws/api-bff-WEB-test-aws.yaml'
    const result = harness({
        openapi: [rule({ awsApiDiscriminator: 'test' }), rule({
            intendedUsage: 'PUBLIC', servicePath: 'location', generatePolicies: false
        })],
        bundlePatch: 'example.patch'
    }, {
        patch(files) {
            const doc = yaml.load(files.get(awsFile))
            doc.paths['/v1/items/{id}'].post = tagged(['PF'])
            files.set(awsFile, yaml.dump(doc))
        }
    })
    await result.module.exports.main()
    assert.deepEqual(result.policyInputs, [awsFile])
    assert.equal(result.output, 'microsvc/docs/openapi/policies/generated')
    assert.deepEqual(Object.keys(result.policies), ['PA', 'PF'])
    assert.match(result.policies.PA.policyDocument.Statement[0].Resource[0], /\/GET\/v1\/items\/\*$/)
    assert.ok(result.events.indexOf('patch') < result.events.indexOf('policies'))
    assert.equal(result.events.includes('cleanup'), false)
    assert.equal(result.errors.length, 0)
})

test('explicit false cleans generated policies after AWS generation and patches', async () => {
    const result = harness({ openapi: [rule({ generatePolicies: false })], bundlePatch: 'example.patch' })
    await result.module.exports.main()
    assert.ok(result.events.some(event => event.startsWith('aws:')))
    assert.equal(result.events.includes('policies'), false)
    assert.equal(result.cleanupOutput, 'microsvc/docs/openapi/policies/generated')
    assert.ok(result.events.indexOf('patch') < result.events.indexOf('cleanup'))
})

test('absent flag leaves AWS generation unchanged and neither writes nor removes policies', async () => {
    const result = harness({ openapi: [rule({ generatePolicies: undefined })] })
    await result.module.exports.main()
    assert.ok(result.events.some(event => event.startsWith('aws:')))
    assert.equal(result.events.includes('policies'), false)
    assert.equal(result.events.includes('cleanup'), false)
})

test('multiple false rules clean once even when AWS generation is skipped', async () => {
    const result = harness({ openapi: [
        rule({ generatePolicies: false, skipAWSGeneration: true }),
        rule({ generatePolicies: false, skipAWSGeneration: true })
    ] })
    await result.module.exports.main()
    assert.equal(result.events.filter(event => event === 'cleanup').length, 1)
    assert.equal(result.events.some(event => event.startsWith('aws:')), false)
})

test('an enabled rule takes precedence over cleanup regardless of configuration order', async () => {
    for (const rules of [
        [rule({ generatePolicies: false }), rule()],
        [rule(), rule({ generatePolicies: false })]
    ]) {
        const result = harness({ openapi: rules })
        await result.module.exports.main()
        assert.equal(result.events.filter(event => event === 'policies').length, 1)
        assert.equal(result.events.includes('cleanup'), false)
        assert.deepEqual(Object.keys(result.policies), ['PA'])
    }
})

test('a failed patch does not delete existing policies', async () => {
    const result = harness({ openapi: [rule({ generatePolicies: false })], bundlePatch: 'bad.patch' }, {
        patch() { throw new Error('Patch failed') }
    })
    await assert.rejects(result.module.exports.main(), /Patch failed/)
    assert.equal(result.events.includes('cleanup'), false)
})

test('enabled rules are aggregated once, including intended usage filename normalization', async () => {
    const result = harness({ openapi: [rule(), rule({ intendedUsage: 'IOL' })] })
    await result.module.exports.main()
    assert.deepEqual(result.policyInputs, [
        'microsvc/docs/openapi/aws/api-bff-WEB-aws.yaml',
        'microsvc/docs/openapi/aws/api-bff-IO-aws.yaml'
    ])
    assert.equal(result.events.filter(event => event === 'policies').length, 1)
    assert.equal(result.policies.PA.policyDocument.Statement[0].Resource.length, 1)
})

test('invalid flag or skipped AWS fails before starting transformations', async () => {
    for (const overrides of [{ generatePolicies: 'true' }, { skipAWSGeneration: true }]) {
        const result = harness({ openapi: [rule(overrides)] })
        await assert.rejects(result.module.exports.main(), /generatePolicies/)
        assert.equal(result.events.length, 0)
    }
})

test('unsupported enabled rule cannot reuse an old AWS file', async () => {
    const result = harness({ openapi: [rule({ intendedUsage: 'UNKNOWN' })] })
    await assert.rejects(result.module.exports.main(), /Unable to generate policies/)
    assert.equal(result.events.includes('policies'), false)
})

test('CLI reports policy errors and exits nonzero rather than logging done', async () => {
    const result = harness({ openapi: [rule()], bundlePatch: 'invalid.patch' }, {
        cli: true,
        patch(files) {
            const file = 'microsvc/docs/openapi/aws/api-bff-WEB-aws.yaml'
            files.set(file, yaml.dump({ paths: { '/test': { get: tagged(['UNKNOWN']) } } }))
        }
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(result.process.exitCode, 1)
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /Code generation failed:.*Unknown cx_type/)
})
