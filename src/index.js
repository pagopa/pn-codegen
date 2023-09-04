const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const { internalToExternal, makeBundle, mergeYaml, removeIntFormat, updateIntegerType, copyYamlFiles } = require('./lib/transformer')
const { buildAWSOpenApiFile } = require('./lib/awsOpenApiBuilder')
const { checkBundles }  = require('./lib/bundleChecker')
const { filterApiDocByPath, removePathPrefix, createFilteredOpenApi, mergeExternalFilesForBundle, removeSchemasPrefixFromFile } = require('./lib/yamlUtils')

const { terraformGenerator } = require('./lib/infra-tf/index')

const openapiFolder = 'microsvc/docs/openapi'
const configFilePath = 'microsvc/codegen/config.json'
const tmpFolder = '/tmp/openapi'

async function doSingleWork(intendedUsage, servicePath, openapiFiles, authorizerConfig){
    if(['B2B', 'WEB', 'IO', 'CN_BE'].indexOf(intendedUsage)<0){
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

    copyYamlFiles(openapiFolder, tmpFolder)

    const configContent = fs.readFileSync(configFilePath)
    const globalConfig = JSON.parse(configContent)

    const authorizerConfigContent = fs.readFileSync('src/config/authorizer.json')
    const authorizerConfig = JSON.parse(authorizerConfigContent)
    const config = globalConfig.openapi || [] // openapi codegen rules

    for(let i=0; i<config.length; i++){
        const { intendedUsage, servicePath, openapiFiles, generateBundle, mergeBeforeBundleGeneration, skipAWSGeneration, bundlePathPrefixes, commonFiles } = config[i]
        const openExternalFiles = []
        console.log(config[i])
        const bundleInputFiles = []
        for(let j=0; j<openapiFiles.length; j++){

            if(commonFiles){
                // for each file, generate the internal-to-external (in place)
                for(let k=0; k<commonFiles.length; k++){
                    await internalToExternal(openapiFolder+'/'+commonFiles[k], tmpFolder+'/'+commonFiles[k])
                }
            }

            const outputFile = openapiFiles[j].replace('internal', 'external')
            await internalToExternal(tmpFolder+'/'+openapiFiles[j], tmpFolder+'/'+outputFile)
            // if common files, create a copy to be restored
            openExternalFiles.push(outputFile)
            const bundleFile = outputFile.replace('.yaml', '-bundle.yaml')
            if(generateBundle){
                let inputFileForBundle = outputFile
                if(bundlePathPrefixes && bundlePathPrefixes.length>0){
                    const cleanForBundleFile = outputFile.replace('.yaml', '-filtered.yaml')
                    inputFileForBundle = tmpFolder+'/'+cleanForBundleFile
                    createFilteredOpenApi(bundlePathPrefixes, tmpFolder+'/'+outputFile, inputFileForBundle)
                } 

                bundleInputFiles.push(tmpFolder+'/'+inputFileForBundle)
                if(!mergeBeforeBundleGeneration){
                    await makeBundle(tmpFolder+'/'+inputFileForBundle, tmpFolder+'/'+bundleFile)
                }
            }
            // if copy files
            await copyYamlFiles(tmpFolder, openapiFolder, [bundleFile, outputFile])
        }

        if(generateBundle && mergeBeforeBundleGeneration){
            if(bundleInputFiles.length===0){
                throw new Error("Bundle input files array is empty")
            }
            const bundleFile = bundleInputFiles[0].replace('.yaml', '-bundle.yaml')
            const mergedFile = bundleInputFiles[0].replace('.yaml', '-merged.yaml')
            mergeExternalFilesForBundle(bundleInputFiles, mergedFile)
            await makeBundle(mergedFile, bundleFile, true)
            await copyYamlFiles(tmpFolder, openapiFolder, [path.basename(mergedFile), path.basename(bundleFile)])
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
