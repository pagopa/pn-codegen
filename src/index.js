const fs = require('fs')
const yaml = require('js-yaml')

const { internalToExternal, makeBundle, mergeYaml, removeIntFormat, updateIntegerType } = require('./lib/transformer')
const { buildAWSOpenApiFile } = require('./lib/awsOpenApiBuilder')
const { checkBundles }  = require('./lib/bundleChecker')
const { filterApiDocByPath, removePathPrefix, createFilteredOpenApi } = require('./lib/yamlUtils')

const { terraformGenerator } = require('./lib/infra-tf/index')

const openapiFolder = 'microsvc/docs/openapi'
const configFilePath = 'microsvc/codegen/config.json'
const tmpFolder = '/tmp/openapi'

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
            doc.paths = filterApiDocByPath(doc.paths, [servicePath])
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
    await buildAWSOpenApiFile(mergedOpenApiFiles, outputFilePath, intendedUsage, authorizerConfig)
    await removeIntFormat(outputFilePath)
    await updateIntegerType(outputFilePath)
}

async function main(){
    fs.mkdirSync(tmpFolder, { recursive: true}) // create target folder if it doesn'\t exist

    const configContent = fs.readFileSync(configFilePath)
    const globalConfig = JSON.parse(configContent)

    const authorizerConfigContent = fs.readFileSync('src/config/authorizer.json')
    const authorizerConfig = JSON.parse(authorizerConfigContent)
    const config = globalConfig.openapi || [] // openapi codegen rules

    for(let i=0; i<config.length; i++){
        const { intendedUsage, servicePath, openapiFiles, generateBundle, skipAWSGeneration, bundlePathPrefixes } = config[i]
        const openExternalFiles = []
        console.log(config[i])
        for(let j=0; j<openapiFiles.length; j++){
            const outputFile = openapiFiles[j].replace('internal', 'external')
            await internalToExternal(openapiFolder, openapiFiles[j], outputFile)
            openExternalFiles.push(outputFile)
            if(generateBundle){
                const bundleFile = outputFile.replace('.yaml', '-bundle.yaml')
                if(bundlePathPrefixes && bundlePathPrefixes.length>0){
                    const cleanForBundleFile = outputFile.replace('.yaml', '-filtered.yaml')
                    createFilteredOpenApi(bundlePathPrefixes, openapiFolder+'/'+outputFile, tmpFolder+'/'+cleanForBundleFile)
                    await makeBundle(tmpFolder+'/'+cleanForBundleFile, openapiFolder+'/'+bundleFile)
                } else {
                    await makeBundle(openapiFolder+'/'+outputFile, openapiFolder+'/'+bundleFile)
                }
            }
        }
        if(!skipAWSGeneration){
            await doSingleWork(intendedUsage, servicePath, openExternalFiles, authorizerConfig)
        }
    }

    if( globalConfig.openapiBundlePresenceCheck ) {
      checkBundles(openapiFolder, globalConfig.openapiBundlePresenceCheck)
    }

    if( globalConfig['infrastructure-tf'] ) {
      await terraformGenerator( globalConfig['infrastructure-tf'], "microsvc/" );
    }
}

main().then(function(){
    console.log('done')
})
