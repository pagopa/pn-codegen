const fs = require('fs')
const yaml = require('js-yaml')
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const _ = require('lodash')

const openapiFolder = 'microsvc/docs/openapi'
const configFilePath = 'microsvc/codegen/config.json'
const tmpFolder = 'microsvc/docs/openapi' // we can't use a different folder to generate tmp files unless we copy all the #refs

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

async function mergeYaml(inputFile, outputFile){
    const { stdout, stderr } = await exec(`redocly bundle ${inputFile} -o ${outputFile}`);

    if (stderr) {
        console.error(`error: ${stderr}`);
    }
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

function getSecuritySchemeByIntendedUsage(intendedUsage){
    if(intendedUsage=='B2B'){
        return {
            'api_key': {
                type: "apiKey",
                name: "x-api-key",
                in: "header"
            },
            'pn-auth-fleet_ApiKeyAuthorizerV2': {
                type: "apiKey",
                name: "x-api-key",
                in: "header",
                'x-amazon-apigateway-authtype': "custom",
                'x-amazon-apigateway-authorizer': {
                    authorizerUri: 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:pn-ApiKeyAuthorizerV2Lambda/invocations',
                    authorizerResultTtlInSeconds: 300,
                    identitySource: "method.request.header.x-api-key",
                    type: "request"
                }
            }
        }
    } else if(intendedUsage=='IO'){
        return {
            'api_key': {
                type: "apiKey",
                name: "x-api-key",
                in: "header"
            },
            'pn-auth-fleet_IoAuthorizer': {
                type: "apiKey",
                name: "Unused",
                in: "header",
                'x-amazon-apigateway-authtype': "custom",
                'x-amazon-apigateway-authorizer': {
                    authorizerUri: 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:pn-ioAuthorizerLambda/invocations',
                    authorizerResultTtlInSeconds: 300,
                    identitySource: "method.request.header.x-api-key, method.request.header.x-pagopa-cx-taxid",
                    type: "request"
                }
            }
        }
    } else if(intendedUsage=='BACKOFFICE'){
        return {
            'pn-auth-fleet_backofficeAuthorizer': {
                type: "apiKey",
                name: "Authorization",
                in: "header",
                'x-amazon-apigateway-authtype': "custom",
                'x-amazon-apigateway-authorizer': {
                    authorizerUri: 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:pn-backofficeAuthorizerLambda/invocations',
                    authorizerResultTtlInSeconds: 300,
                    type: "token"
                }
            }
        }
    } else if(intendedUsage=='WEB'){
        return {
            'pn-auth-fleet_jwtAuthorizer': {
                type: "apiKey",
                name: "Authorization",
                in: "header",
                'x-amazon-apigateway-authtype': "custom",
                'x-amazon-apigateway-authorizer': {
                    authorizerUri: 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:pn-jwtAuthorizerLambda/invocations',
                    authorizerResultTtlInSeconds: 300,
                    type: "token"                    
                }
            }
        }
    } else if(intendedUsage=='PNPG') {
        return {
            'api_key': {
                type: "apiKey",
                name: "x-api-key",
                in: "header"
            }
        }
    } else {
        return {}
    }
}

function getMethodSecurityItemsByIntendedUsage(intendedUsage){

    if(intendedUsage=='B2B'){
        return [
            { 'pn-auth-fleet_ApiKeyAuthorizerV2': [] },
            { 'api_key': [] }
        ]
    } else if(intendedUsage=='IO'){
        return [
            { 'pn-auth-fleet_IoAuthorizer': [] },
            { 'api_key': [] }
        ]    
    } else if(intendedUsage=='BACKOFFICE'){
        return [
            { 'pn-auth-fleet_backofficeAuthorizer': [] }
        ]
    } else if(intendedUsage=='WEB'){
        return [
            { 'pn-auth-fleet_jwtAuthorizer': [] }
        ] 
    } else if(intendedUsage=='PNPG') {
        return [
            { 'api_key': [] }
        ] 
    } else {
        return [
            
        ] 
    }

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
    return parameters;
}

function enrichPaths(paths, intendedUsage){
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

            paths[path][method].security = getMethodSecurityItemsByIntendedUsage(intendedUsage)
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

    paths['/v3/api-docs'] = {
        'x-amazon-apigateway-any-method': {
            operationId: "Proxy to pn-delivery public api-docs",
            'x-amazon-apigateway-integration': {
                uri: "http://${stageVariables.ApplicationLoadBalancerDomain}:8080/${stageVariables.ServiceApiPath}/v3/api-docs",
                connectionId: "${stageVariables.NetworkLoadBalancerLink}",
                httpMethod: "ANY",
                passthroughBehavior: "when_no_match",
                connectionType: "VPC_LINK",
                timeoutInMillis: 29000,
                type: "http_proxy"
            } 
        }
    }

}

async function joinYamlFiles(files, outputFile, intendedUsage){
    let finalDoc = {
        openapi: '3.0.1',
        info: {
            title: '${stageVariables.ProjectName}-${stageVariables.MicroServiceUniqueName}-${stageVariables.IntendedUsage}',
            version: new Date().toISOString()
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
            securitySchemes: getSecuritySchemeByIntendedUsage(intendedUsage)
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
        }
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
    enrichPaths(finalDoc.paths, intendedUsage)
    const yamlString = yaml.dump(finalDoc).replace('schemas-ProblemError', 'ProblemError')
    fs.writeFileSync(outputFile, yamlString)
}

async function internalToExternal(inputFile, outputFile){
    const command = `cat ${openapiFolder}/${inputFile} | sed -e '/.*<details no-external>.*/,/<\\/details>/ d' | grep -v "# NO EXTERNAL" | grep -v "# NOT YET IMPLEMENTED" | sed -e '/# ONLY EXTERNAL/s/^#//' > ${openapiFolder}/${outputFile}`
    
    console.log('internal to external', command)
    const { stdout, stderr } = await exec(command);

    if (stderr) {
        console.error(`internal to external error: ${stderr}`);
    }
    console.log(`${stdout}`);
}

async function makeBundle(inputFile, outputFile){

    const redoclyCommand = `redocly bundle ${openapiFolder}/${inputFile} --output ${openapiFolder}/${outputFile}`
    const lintCommand = `spectral lint -r https://italia.github.io/api-oas-checker/spectral.yml ${openapiFolder}/${outputFile}`

    console.log(redoclyCommand)
    const { stdout, stderr } = await exec(redoclyCommand);

    if (stderr) {
        console.error(`redocly error: ${stderr}`);
    }
    
    console.log(lintCommand)
    const { lintStdout, lintStderr } = await exec(lintCommand);

    if (lintStderr) {
        console.error(`lint error: ${lintStderr}`);
    }
    

}
async function doSingleWork(intendedUsage, servicePath, openapiFiles){
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
    await joinYamlFiles(mergedOpenApiFiles, outputFilePath, intendedUsage)
}

async function doWork(){
    fs.mkdirSync(tmpFolder, { recursive: true}) // create target folder if it doesn'\t exist

    const configContent = fs.readFileSync(configFilePath)
    const globalConfig = JSON.parse(configContent)

    const config = globalConfig.openapi // openapi codegen rules

    for(let i=0; i<config.length; i++){
        const { intendedUsage, servicePath, openapiFiles, generateBundle } = config[i]
        const openExternalFiles = []
        console.log(config[i])
        for(let j=0; j<openapiFiles.length; j++){
            const outputFile = openapiFiles[j].replace('internal', 'external')
            await internalToExternal(openapiFiles[j], outputFile)
            openExternalFiles.push(outputFile)
            if(generateBundle){
                const bundleFile = outputFile.replace('.yaml', '-bundle.yaml')
                await makeBundle(outputFile, bundleFile)
            }
        }
        await doSingleWork(intendedUsage, servicePath, openExternalFiles)
    }
}
doWork().then(function(){
    console.log('done')
})
