const fs = require('fs')
const yaml = require('js-yaml')
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const _ = require('lodash')

const openapiFolder = process.argv[2]
const configFilePath = process.argv[3]

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
                    authorizerUri: 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${stageVariables.ProjectName}-ApiKeyAuthorizerV2Lambda/invocations',
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
                    authorizerUri: 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${stageVariables.ProjectName}-ApiKeyAuthorizerV2Lambda/invocations',
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
                    authorizerUri: 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${stageVariables.ProjectName}-backofficeAuthorizerLambda/invocations',
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
                    authorizerUri: 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${stageVariables.ProjectName}-jwtAuthorizerLambda/invocations',
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

function getRequestParametersByIntendedUsage(intendedUsage){
    return {
        'integration.request.header.x-pagopa-pn-cx-id': "context.authorizer.cx_id",
        'integration.request.path.proxy': "method.request.path.proxy",
        'integration.request.header.x-pagopa-pn-cx-role': "context.authorizer.cx_role",
        'integration.request.header.x-pagopa-pn-uid': "context.authorizer.uid",
        'integration.request.header.x-pagopa-pn-jti': "context.authorizer.cx_jti",
        'integration.request.header.x-pagopa-pn-src-ch': "'"+intendedUsage+"'",
        'integration.request.header.x-pagopa-pn-cx-type': "context.authorizer.cx_type",
        'integration.request.header.x-pagopa-pn-cx-groups': "context.authorizer.cx_groups"
    } 
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
                requestParameters: getRequestParametersByIntendedUsage(intendedUsage),
                passthroughBehavior: "when_no_match",
                connectionType: "VPC_LINK",
                timeoutInMillis: 29000,
                type: "http_proxy"
            }

            if(!paths[path][method].parameters){
                paths[path][method].parameters = [];
            }
            paths[path][method].parameters.push({
                name: "proxy",
                in: "path",
                required: true,
                schema: {
                    type: "string"
                }
            })
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
    fs.writeFileSync(outputFile, yaml.dump(finalDoc))
}

async function internalToExternal(inputFile, outputFile){
    const command = `cat ${openapiFolder}/${inputFile} | sed -e '/.*<details no-external>.*/,/<\\/details>/ d' | grep -v "# NO EXTERNAL" | sed -e '/# ONLY EXTERNAL/s/^#//' > ${openapiFolder}/${outputFile}`
    
    console.log('internal to external', command)
    const { stdout, stderr } = await exec(command);

    if (stderr) {
        console.error(`internal to external error: ${stderr}`);
    }
    console.log(`${stdout}`);
}

async function generateBundle(inputFile, outputFile){

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
    
            fs.writeFileSync(openapiFolder+'/clean-'+openapiFiles[i], yaml.dump(doc))
    
            await mergeYaml(openapiFolder+'/clean-'+openapiFiles[i], openapiFolder+'/merged-'+openapiFiles[i])
            mergedOpenApiFiles.push(openapiFolder+'/merged-'+openapiFiles[i])
        } catch (e) {
            console.error('File '+openapiFilePath+' yaml parsing error: '+e.message)
            console.debug(e);
            process.exit(1)
        }
    
    }

    const outputFilePath = openapiFolder+`/api-${servicePath}-${intendedUsage}-aws.yaml`
    await joinYamlFiles(mergedOpenApiFiles, outputFilePath, intendedUsage)
}

async function doWork(){
    const configFile = openapiFolder+'/'+configFilePath
    const configContent = fs.readFileSync(configFile)
    const config = JSON.parse(configContent)

    for(let i=0; i<config.length; i++){
        const { intendedUsage, servicePath, openapiFiles } = config[i]
        const openExternalFiles = []
        console.log(config[i])
        for(let j=0; j<openapiFiles.length; j++){
            const outputFile = openapiFiles[j].replace('internal', 'external')
            await internalToExternal(openapiFiles[j], outputFile)
            openExternalFiles.push(outputFile)
            if(intendedUsage=='B2B'){
                const bundleFile = outputFile.replace('.yaml', '-bundle.yaml')
                await generateBundle(outputFile, bundleFile)
            }
        }
        await doSingleWork(intendedUsage, servicePath, openExternalFiles)
    }
}
doWork().then(function(){
    console.log('done')
})
