const fs = require('fs')
const yaml = require('js-yaml')
const _ = require('lodash')
const crypto = require('crypto');

const { internalToExternal, makeBundle, mergeYaml } = require('./lib/transformer')
const { getSecuritySchemeByIntendedUsage, getMethodSecurityItemsByIntendedUsage } = require('./lib/authorizer')

const openapiFolder = 'microsvc/docs/openapi'
const configFilePath = 'microsvc/codegen/config.json'
const tmpFolder = '/tmp/openapi'

function filterApiDocByPath(paths, servicePath){
    const regexp = new RegExp('^/'+servicePath+'/');
    return Object.fromEntries(Object.entries(paths).filter(([key]) => regexp.test(key)));
}

function removePathPrefix(paths, servicePath){
    const regexp = new RegExp('^/'+servicePath+'/');
    return Object.fromEntries(
        Object.entries(paths).map(([key, val]) => {
            const newKey = key.replace(regexp, '/')
            return  [newKey, val]
        })
    );
}

function deepObjectMerge(finalPaths, docPaths){
    _.forOwn(docPaths, function(methods, path) {
        if(!finalPaths[path]){
            finalPaths[path] = methods
        } else {
            _.forOwn(methods, function(methodDetail, method) {
                if(!finalPaths[path][method]){
                    finalPaths[path][method] = methodDetail
                }
            });
        }
    });
}

function getPathParams(path){
    return [...path.matchAll(/({.*?})/g)].map((p) => {
        return p[1].replace('{', '').replace('}', '')
    })
}

function getRequestParametersByIntendedUsage(intendedUsage, path, options = false){
    const parameters = {}

    if(!options){
        Object.assign(parameters, {
            'integration.request.header.x-pagopa-pn-cx-id': "context.authorizer.cx_id",
            'integration.request.header.x-pagopa-pn-cx-role': "context.authorizer.cx_role",
            'integration.request.header.x-pagopa-pn-uid': "context.authorizer.uid",
            'integration.request.header.x-pagopa-pn-jti': "context.authorizer.cx_jti",
            'integration.request.header.x-pagopa-pn-src-ch': "'"+intendedUsage+"'",
            'integration.request.header.x-pagopa-pn-cx-type': "context.authorizer.cx_type",
            'integration.request.header.x-pagopa-pn-cx-groups': "context.authorizer.cx_groups"
        });
    }

    const pathParams = getPathParams(path)
    for(let i=0; i<pathParams.length; i++){
        parameters['integration.request.path.'+pathParams[i]] = "method.request.path."+pathParams[i]    
    } 

    // nella UI di AWS, l'opzione "Use Proxy Integration" riporta "Requests will be proxied to your VPC Link's endpoint." il che implica il passaggio di tutti i parametri
    // della richiesta originali, inclusi header e query string
    return parameters;
}

function enrichPaths(paths, intendedUsage, authorizerConfig){
    _.forOwn(paths, function(methods, path) {
        _.forOwn(methods, function(methodDetail, method) {
            paths[path].options = {
                operationId: "Options for "+path+" API CORS",
                'x-amazon-apigateway-integration': {
                    uri: "http://${stageVariables.ApplicationLoadBalancerDomain}:8080/${stageVariables.ServiceApiPath}"+path,
                    connectionId: "${stageVariables.NetworkLoadBalancerLink}",
                    httpMethod: "ANY",
                    requestParameters: getRequestParametersByIntendedUsage(intendedUsage, path, true),
                    passthroughBehavior: "when_no_match",
                    connectionType: "VPC_LINK",
                    timeoutInMillis: 29000,
                    type: "http_proxy"
                }
            }

            paths[path][method].security = getMethodSecurityItemsByIntendedUsage(intendedUsage, authorizerConfig)
            paths[path][method]['x-amazon-apigateway-integration'] = {
                uri: "http://${stageVariables.ApplicationLoadBalancerDomain}:8080/${stageVariables.ServiceApiPath}"+path,
                connectionId: "${stageVariables.NetworkLoadBalancerLink}",
                httpMethod: "ANY",
                requestParameters: getRequestParametersByIntendedUsage(intendedUsage, path),
                passthroughBehavior: "when_no_match",
                connectionType: "VPC_LINK",
                timeoutInMillis: 29000,
                type: "http_proxy"
            }

            if(!paths[path][method].parameters){
                paths[path][method].parameters = [];
            }
        });
    });
}

async function joinYamlFiles(files, outputFile, intendedUsage, authorizerConfig){
    let finalDoc = {
        openapi: '3.0.1',
        info: {
            title: '${stageVariables.ProjectName}-${stageVariables.MicroServiceUniqueName}-${stageVariables.IntendedUsage}',
        },
        servers: [
            {
                url: "https://${stageVariables.DnsName}/{basePath}",
                variables: {
                    basePath: {
                        default: "/${stageVariables.ServiceApiPath}"
                    }
                },
                'x-amazon-apigateway-endpoint-configuration': {
                    disableExecuteApiEndpoint: true
                }
            }
        ],
        paths: {},
        components: {
            parameters: {},
            schemas: {},
            responses: {},
            securitySchemes: getSecuritySchemeByIntendedUsage(intendedUsage, authorizerConfig)
        },
        tags: [],
        'x-amazon-apigateway-gateway-responses':{
            DEFAULT_5XX: {
                responseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'*'"   
                }
            },
            DEFAULT_4XX: {
                responseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'*'"   
                }
            }
        },
        "x-amazon-apigateway-request-validators" : {
            basic : {
              validateRequestBody: true,
              validateRequestParameters: true
            },
            "params-only" : {
              validateRequestBody: false,
              validateRequestParameters: true
            }
        },
        "x-amazon-apigateway-request-validator" : "basic" // validate parameters and body for all requests
    }

    for(let i=0; i<files.length; i++){
        // first file will include everything
        let fileContent = fs.readFileSync(files[i], 'utf-8')
        const doc = yaml.load(fileContent);
        finalDoc.tags = _.uniqBy(_.concat(finalDoc.tags, doc.tags), 'name')
        deepObjectMerge(finalDoc.paths, doc.paths)
        Object.assign(finalDoc.components.parameters, doc.components.parameters)
        //Object.assign(finalDoc.components.securitySchemes, doc.components.securitySchemes)
        Object.assign(finalDoc.components.schemas, doc.components.schemas)
        Object.assign(finalDoc.components.responses, doc.components.responses || {})
    }

    delete finalDoc.components.schemas['schemas-ProblemError']
    enrichPaths(finalDoc.paths, intendedUsage, authorizerConfig)
    const yamlString = yaml.dump(finalDoc, { noRefs: true })

    const hash = crypto.createHash('sha256').update(yamlString).digest('base64');
    finalDoc.info.version = hash // add sha256 as version

    // la sostituzione è richiesta in quanto AWS non supporta risorse con il carattere "-"; inoltre, ProblemError e schemas-ProblemError sono duplicati
    // ed andrebbe indagato il problema a livello di definizione di OpenAPI
    const yamlStringWithVersion = yaml.dump(finalDoc,  { noRefs: true }).replace('schemas-ProblemError', 'ProblemError') 
    fs.writeFileSync(outputFile, yamlStringWithVersion)
}

async function doSingleWork(intendedUsage, servicePath, openapiFiles, authorizerConfig){
    if(['B2B', 'WEB', 'IO'].indexOf(intendedUsage)<0){
        console.error('Intended usage not supported: '+intendedUsage)
        return
    }
    const mergedOpenApiFiles = []
    for(let i=0; i<openapiFiles.length; i++){
        const openapiFilePath = openapiFolder+'/'+openapiFiles[i]
        const fileContent = fs.readFileSync(openapiFilePath, 'utf-8')
    
        try {
            const doc = yaml.load(fileContent);
            // loop through methods and remove all methods that don't match the service path
            doc.paths = filterApiDocByPath(doc.paths, servicePath)
            doc.paths = removePathPrefix(doc.paths, servicePath)
    
            fs.writeFileSync(tmpFolder+'/clean-'+openapiFiles[i], yaml.dump(doc))
    
            await mergeYaml(tmpFolder+'/clean-'+openapiFiles[i], tmpFolder+'/merged-'+openapiFiles[i])
            mergedOpenApiFiles.push(tmpFolder+'/merged-'+openapiFiles[i])
        } catch (e) {
            console.error('File '+openapiFilePath+' yaml parsing error: '+e.message)
            console.debug(e);
            process.exit(1)
        }
    
    }

    fs.mkdirSync(openapiFolder+'/aws', { recursive: true })
    const outputFilePath = openapiFolder+`/aws/api-${servicePath}-${intendedUsage}-aws.yaml`
    await joinYamlFiles(mergedOpenApiFiles, outputFilePath, intendedUsage, authorizerConfig)
}

async function main(){
    fs.mkdirSync(tmpFolder, { recursive: true}) // create target folder if it doesn'\t exist

    const configContent = fs.readFileSync(configFilePath)
    const globalConfig = JSON.parse(configContent)

    const authorizerConfigContent = fs.readFileSync('src/config/authorizer.json')
    const authorizerConfig = JSON.parse(authorizerConfigContent)
    const config = globalConfig.openapi // openapi codegen rules

    for(let i=0; i<config.length; i++){
        const { intendedUsage, servicePath, openapiFiles, generateBundle } = config[i]
        const openExternalFiles = []
        console.log(config[i])
        for(let j=0; j<openapiFiles.length; j++){
            const outputFile = openapiFiles[j].replace('internal', 'external')
            await internalToExternal(openapiFolder, openapiFiles[j], outputFile)
            openExternalFiles.push(outputFile)
            if(generateBundle){
                const bundleFile = outputFile.replace('.yaml', '-bundle.yaml')
                await makeBundle(openapiFolder, outputFile, bundleFile)
            }
        }
        await doSingleWork(intendedUsage, servicePath, openExternalFiles, authorizerConfig)
    }
}
main().then(function(){
    console.log('done')
})
