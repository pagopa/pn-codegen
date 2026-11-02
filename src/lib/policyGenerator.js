const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const { createPathCoverage, resourcePath } = require('./policyPathCoverage')

const CX_TYPES_EXTENSION = 'x-pn-allowed-cx-types'
const CX_TYPES = new Set(['PA', 'PG', 'PF', 'BS', 'PT'])
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])
const ANY_METHODS = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']
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
    // La stessa rotta può comparire in più documenti: i cx_type consentiti vengono uniti
    const routes = new Map()
    const explicitMethodsByPath = new Map()
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
                const allowedCxTypes = operation[CX_TYPES_EXTENSION] === undefined ? [] : operation[CX_TYPES_EXTENSION]
                if (!Array.isArray(allowedCxTypes)) {
                    throw new Error(`${CX_TYPES_EXTENSION} must be an array on ${method} ${apiPath}`)
                }
                for (const cxType of allowedCxTypes) {
                    if (!CX_TYPES.has(cxType)) {
                        throw new Error(`Unknown cx_type "${cxType}" on ${method} ${apiPath}`)
                    }
                }
                const routeKey = `${method} ${apiPath}`
                if (!routes.has(routeKey)) {
                    routes.set(routeKey, { method, apiPath, allowedCxTypes: new Set() })
                }
                allowedCxTypes.forEach(cxType => routes.get(routeKey).allowedCxTypes.add(cxType))
                if (!explicitMethodsByPath.has(apiPath)) {
                    explicitMethodsByPath.set(apiPath, new Set())
                }
                explicitMethodsByPath.get(apiPath).add(method)
            }
        }
    }
    const routeList = [...routes.values()].flatMap(route => route.method === '*' ?
        ANY_METHODS.filter(method => !explicitMethodsByPath.get(route.apiPath).has(method))
            .map(method => ({ ...route, method })) : [route])
    const covers = createPathCoverage([...explicitMethodsByPath.keys()])
    const cxTypes = [...new Set(routeList.flatMap(route => [...route.allowedCxTypes]))].sort()
    return Object.fromEntries(cxTypes.map(cxType =>
        [cxType, buildPolicy(cxType, routeList, covers)]))
}

const toResource = route => `${RESOURCE_PREFIX}/${route.method}${resourcePath(route.apiPath)}`
const describe = route => `${route.method} ${route.apiPath}`

/**
 * Le wildcard dei path param coprono anche le rotte con lo stesso prefisso (es. GET /received/* copre
 * GET /received/delegated): le rotte non consentite al cx_type ma coperte da una Resource consentita
 * vengono negate esplicitamente, perché in IAM il Deny prevale sull'Allow.
 */
function buildPolicy(cxType, routes, covers) {
    const allowed = routes.filter(route => route.allowedCxTypes.has(cxType))
    const denied = routes.filter(route => !route.allowedCxTypes.has(cxType) &&
        allowed.some(allowedRoute => covers(allowedRoute, route)))
    for (const deniedRoute of denied) {
        const blocked = allowed.find(allowedRoute => covers(deniedRoute, allowedRoute))
        if (blocked) {
            throw new Error(`Cannot deny ${describe(deniedRoute)} to cx_type ${cxType} ` +
                `without also denying ${describe(blocked)}`)
        }
    }
    const statement = (effect, statementRoutes) => ({
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: statementRoutes.map(toResource).sort()
    })
    return {
        principalId: 'user',
        policyDocument: {
            Version: '2012-10-17',
            Statement: denied.length > 0 ?
                [statement('Allow', allowed), statement('Deny', denied)] :
                [statement('Allow', allowed)]
        },
        context: {}
    }
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
    removeObsoletePolicies(outputDir, files)
}

function removeObsoletePolicies(outputDir, currentFiles = new Set()) {
    if (!fs.existsSync(outputDir)) {
        console.log(`No generated policy directory to clean: ${outputDir}`)
        return
    }
    for (const file of fs.readdirSync(outputDir)) {
        if (/^(pa|pg|pf|bs|pt)Policy\.json$/.test(file) && !currentFiles.has(file)) {
            fs.unlinkSync(path.join(outputDir, file))
            console.log(`Removed obsolete generated policy ${path.join(outputDir, file)}`)
        }
    }
}

module.exports = { isPolicyGenerationEnabled, buildPolicies, generatePolicies, removeObsoletePolicies }
