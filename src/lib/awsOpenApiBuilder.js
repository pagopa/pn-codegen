const fs = require('fs')
const crypto = require('crypto');
const _ = require('lodash')
const yaml = require('js-yaml')

const { getSecuritySchemeByIntendedUsage, getMethodSecurityItemsByIntendedUsage } = require('./authorizer');

const typeLevelKeepProperties = ['title', 'required', 'description', 'default', 'nullable']
const notAllowedProperties = ['multipleOf', 'xml']

// headers used to control throttling
const throttlingHeaders = ['x-pagopa-pn-custom-throttling-group', 'x-pagopa-pn-custom-throttling-value']        

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

function getRequestParametersByIntendedUsage(intendedUsage, path, options = false, authorizerConfig, pathConfig = {}){
    const parameters = {}

    if(!options){
        const defaultMapping = authorizerConfig.mapping.default
        const intendedUsageMapping = authorizerConfig.mapping[intendedUsage]
        const mapping = _.merge(defaultMapping, intendedUsageMapping)

        Object.assign(parameters, mapping);

        // search for pathConfig the whitelistHeaders and set as parameters for the integration
        for(let i=0; i<throttlingHeaders.length; i++){
            if(pathConfig[throttlingHeaders[i]]){
                // if pathConfig starts with method.request then set as is else set in "'"+value+"'"
                const value = pathConfig[throttlingHeaders[i]].startsWith('method.request')?pathConfig[throttlingHeaders[i]]:"'"+pathConfig[throttlingHeaders[i]]+"'"    
                parameters['integration.request.header.'+throttlingHeaders[i]] = value
            }
        }
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
//            console.log('method detail', methodDetail)
//            console.log('method', method)
//            console.log('path', path)

            // check if integration is lambda
            const lambdaName = paths[path][method]['x-pagopa-lambda-name']
            const accountId = paths[path][method]['x-pagopa-lambda-account']==='confinfo'?'${ConfidentialInfoAccountId}':'${AWS::AccountId}'

            paths[path][method].security = getMethodSecurityItemsByIntendedUsage(intendedUsage, authorizerConfig)
            if(lambdaName){
                let integrationUri = "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:${AWS::Region}:"+accountId+":function:"+lambdaName+"/invocations"
                if(paths[path][method]['x-pagopa-lambda-account']==='confinfo'){
                    integrationUri = {
                        'Fn::Sub': integrationUri
                    }
                }
                paths[path][method]['x-amazon-apigateway-integration'] = {
                    uri: integrationUri,
                    httpMethod: "POST",
                    requestParameters: getRequestParametersByIntendedUsage(intendedUsage, path, false, authorizerConfig, paths[path][method]),
                    passthroughBehavior: "when_no_match",
                    contentHandling: "CONVERT_TO_TEXT",
                    timeoutInMillis: 29000,
                    type: "aws_proxy"
                }
                
                if(intendedUsage==='WEB'){
                    paths[path].options = {
                        operationId: "Options for "+path+" API CORS",
                        'x-amazon-apigateway-integration': {
                            uri: integrationUri,
                            httpMethod: "POST",
                            requestParameters: getRequestParametersByIntendedUsage(intendedUsage, path, true, authorizerConfig, paths[path][method]),
                            passthroughBehavior: "when_no_match",
                            contentHandling: "CONVERT_TO_TEXT",
                            timeoutInMillis: 29000,
                            type: "aws_proxy"
                        }
                    }
                }

                if(paths[path][method]['x-api-cachekey-parameters']){
                    paths[path][method]['x-amazon-apigateway-integration']['cacheKeyParameters'] = paths[path][method]['x-api-cachekey-parameters']
                }
            } else {
                const customRewritePath = paths[path][method]['x-pagopa-rewrite-path']
                const apiPath = customRewritePath?customRewritePath:"${stageVariables.ServiceApiPath}"+path

                paths[path].options = {
                    // TODO: options is not required for all intended usages
                    operationId: "Options for "+path+" API CORS",
                    'x-amazon-apigateway-integration': {
                        uri: "http://${stageVariables.ApplicationLoadBalancerDomain}:8080/"+apiPath,
                        connectionId: "${stageVariables.NetworkLoadBalancerLink}",
                        httpMethod: "ANY",
                        requestParameters: getRequestParametersByIntendedUsage(intendedUsage, path, true, authorizerConfig, paths[path][method]),
                        passthroughBehavior: "when_no_match",
                        connectionType: "VPC_LINK",
                        timeoutInMillis: 29000,
                        type: "http_proxy"
                    }
                }
    
                paths[path][method]['x-amazon-apigateway-integration'] = {
                    uri: "http://${stageVariables.ApplicationLoadBalancerDomain}:8080/"+apiPath,
                    connectionId: "${stageVariables.NetworkLoadBalancerLink}",
                    httpMethod: "ANY",
                    requestParameters: getRequestParametersByIntendedUsage(intendedUsage, path, false, authorizerConfig, paths[path][method]),
                    passthroughBehavior: "when_no_match",
                    connectionType: "VPC_LINK",
                    timeoutInMillis: 29000,
                    type: "http_proxy"
                }    


                if(paths[path][method]['x-api-cachekey-parameters']){
                    paths[path][method]['x-amazon-apigateway-integration']['cacheKeyParameters'] = paths[path][method]['x-api-cachekey-parameters']
                }
            }

            if(!paths[path][method].parameters){
                paths[path][method].parameters = [];
            } else {
                adaptYamlObjectForNullable(paths[path][method], 'parameters', 0)
            }
        });
    });
}

function validateObjectProperties(name, currentObject){
    const properties = _.pick(currentObject, notAllowedProperties)
    if(_.keys(properties).length>0){
        throw new Error('Found not allowed keys in object '+name+': '+_.keys(properties).join(', '))
    }
}

function adaptYamlObjectForNullable(currentObject, keyName, level = 0){
    // we currently support one nesting level on properties
    if(currentObject[keyName]){
        _.forOwn(currentObject[keyName], function(property, propertyName){
            validateObjectProperties(propertyName, property)
            if(property.nullable){
                const schemaToKeep = _.omit(property, typeLevelKeepProperties)

                delete property['nullable']
                const keysToRemove = _.keys(schemaToKeep)
                delete schemaToKeep['nullable']
                for(let i=0; i<keysToRemove.length; i++){
                    delete property[keysToRemove[i]]
                }

                if(level<=0){ // limit recursion
                    adaptYamlObjectForNullable(schemaToKeep, 'properties', level+1)
                }
        
                property.oneOf = [
                    schemaToKeep,
                    {
                        type: 'null'
                    }
                ]    
            } else {
                if(level<=0){ // limit recursion
                    adaptYamlObjectForNullable(property, 'properties', level+1)
                }
            }
        })
    }
}

function adaptYamlSchemaForNullable(yamlObject){
    adaptYamlObjectForNullable(yamlObject.components, 'schemas', 0)
}


async function buildAWSOpenApiFile(files, outputFile, intendedUsage, authorizerConfig){
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
            },
            BAD_REQUEST_PARAMETERS: {
                responseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'*'"   
                },
                responseTemplates: {         
                    'application/json': "{\"status\": 400, \"title\": \"VALIDATION ERROR\", \"traceId\": \"$context.xrayTraceId\", \"errors\": [ { \"code\": \"PN_INVALID_PARAMETERS\", \"detail\": \"Validation errors: $context.error.validationErrorString\" } ]}"
                }
            },
            BAD_REQUEST_BODY: {
                responseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'*'"   
                },
                responseTemplates: {         
                    'application/json': "{\"status\": 400, \"title\": \"VALIDATION ERROR\", \"traceId\": \"$context.xrayTraceId\", \"errors\": [ { \"code\": \"PN_INVALID_BODY\", \"detail\": \"Validation errors: $context.error.validationErrorString\" } ]}"
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
    
    if (intendedUsage === 'WEB') {
        ['BAD_REQUEST_PARAMETERS', 'BAD_REQUEST_BODY'].forEach(key => {
            if (finalDoc['x-amazon-apigateway-gateway-responses'][key]) {
                finalDoc['x-amazon-apigateway-gateway-responses'][key].responseParameters['gatewayresponse.header.Access-Control-Expose-Headers'] = "'x-amzn-trace-id'";
            }
        });
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

    adaptYamlSchemaForNullable(finalDoc)

    const yamlString = yaml.dump(finalDoc, { noRefs: true })

    const hash = crypto.createHash('sha256').update(yamlString).digest('base64');
    finalDoc.info.version = hash // add sha256 as version

    // la sostituzione è richiesta in quanto AWS non supporta risorse con il carattere "-"; inoltre, ProblemError e schemas-ProblemError sono duplicati
    // ed andrebbe indagato il problema a livello di definizione di OpenAPI
    const yamlStringWithVersion = yaml.dump(finalDoc,  { noRefs: true }).replace('schemas-ProblemError', 'ProblemError') 
    fs.writeFileSync(outputFile, yamlStringWithVersion)
}

module.exports = {
    buildAWSOpenApiFile
}