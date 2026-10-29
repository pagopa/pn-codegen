const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const CX_TYPES_EXTENSION = 'x-pn-allowed-cx-types'
const CX_TYPES = new Set(['PA', 'PG', 'PF', 'BS', 'PT'])
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])
const RESOURCE_PREFIX = 'arn:aws:execute-api:{region}:{awsAccountId}:{restApiId}/{stage}'

function isPolicyGenerationEnabled(config) {
    if (config.generatePolicies !== undefined && typeof config.generatePolicies !== 'boolean') {
        throw new Error('generatePolicies must be a boolean')
    }
    if (config.generatePolicies === true && config.skipAWSGeneration) {
        throw new Error('generatePolicies requires AWS OpenAPI generation: remove skipAWSGeneration')
    }
    return config.generatePolicies === true
}

function buildPolicies(openapiDocs) {
    const resourcesByCxType = new Map()
    for (const doc of openapiDocs) {
        if (!doc || !doc.paths || typeof doc.paths !== 'object' || Array.isArray(doc.paths)) {
            throw new Error('Policy generation requires an OpenAPI paths object')
        }
        for (const [apiPath, pathItem] of Object.entries(doc.paths)) {
            if (!apiPath.startsWith('/') || !pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) {
                throw new Error(`Invalid OpenAPI path: ${apiPath}`)
            }
            for (const [key, operation] of Object.entries(pathItem)) {
                const method = key === 'x-amazon-apigateway-any-method' ? '*' :
                    HTTP_METHODS.has(key) ? key.toUpperCase() : undefined
                if (!method) {
                    continue
                }
                if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
                    throw new Error(`Invalid operation on ${method} ${apiPath}`)
                }
                const allowedCxTypes = operation[CX_TYPES_EXTENSION]
                if (allowedCxTypes === undefined) {
                    continue
                }
                if (!Array.isArray(allowedCxTypes)) {
                    throw new Error(`${CX_TYPES_EXTENSION} must be an array on ${method} ${apiPath}`)
                }
                for (const cxType of allowedCxTypes) {
                    if (!CX_TYPES.has(cxType)) {
                        throw new Error(`Unknown cx_type "${cxType}" on ${method} ${apiPath}`)
                    }
                    if (!resourcesByCxType.has(cxType)) {
                        resourcesByCxType.set(cxType, new Set())
                    }
                    const resource = `${RESOURCE_PREFIX}/${method}${apiPath.replace(/\{[^}]+\}/g, '*')}`
                    resourcesByCxType.get(cxType).add(resource)
                }
            }
        }
    }
    return Object.fromEntries([...resourcesByCxType.keys()].sort().map(cxType => [cxType, {
        principalId: 'user',
        policyDocument: {
            Version: '2012-10-17',
            Statement: [{
                Action: 'execute-api:Invoke',
                Effect: 'Allow',
                Resource: [...resourcesByCxType.get(cxType)].sort()
            }]
        },
        context: {}
    }]))
}

function generatePolicies(openapiFiles, outputDir) {
    if (openapiFiles.length === 0) {
        throw new Error('Policy generation requires at least one generated AWS OpenAPI file')
    }
    const docs = openapiFiles.map(file => yaml.load(fs.readFileSync(file, 'utf8')))
    const policies = buildPolicies(docs)
    const files = new Set(Object.keys(policies).map(cxType => `${cxType.toLowerCase()}Policy.json`))

    fs.mkdirSync(outputDir, { recursive: true })
    for (const [cxType, policy] of Object.entries(policies)) {
        const file = path.join(outputDir, `${cxType.toLowerCase()}Policy.json`)
        fs.writeFileSync(file, JSON.stringify(policy, null, 2) + '\n')
        console.log(`Generated ${file} (${policy.policyDocument.Statement[0].Resource.length} resources)`)
    }
    for (const file of fs.readdirSync(outputDir)) {
        if (/^(pa|pg|pf|bs|pt)Policy\.json$/.test(file) && !files.has(file)) {
            fs.unlinkSync(path.join(outputDir, file))
            console.log(`Removed obsolete generated policy ${path.join(outputDir, file)}`)
        }
    }
}

module.exports = { isPolicyGenerationEnabled, buildPolicies, generatePolicies }
