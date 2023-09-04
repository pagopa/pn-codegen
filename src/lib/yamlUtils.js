const fs = require('fs')
const _ = require('lodash')
const yaml = require('js-yaml')

function filterApiDocByPath(paths, servicePaths){
    let finalPaths = {}
    for(let i=0; i<servicePaths.length; i++){
        const regexp = new RegExp('^/'+servicePaths[i]+'(\/.*)?$');
        finalPaths = _.merge(finalPaths, Object.fromEntries(Object.entries(paths).filter(([key]) => regexp.test(key))));
    }
    return finalPaths;
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

function createFilteredOpenApi(pathPrefixes, inputFile, outputFile){
    const openapiFilePath = inputFile
    const fileContent = fs.readFileSync(openapiFilePath, 'utf-8')

    const doc = yaml.load(fileContent);
    doc.paths = filterApiDocByPath(doc.paths, pathPrefixes)

    fs.writeFileSync(outputFile, yaml.dump(doc))
}

function deepMergePaths(masterPaths, newPaths){
    _.forOwn(newPaths, function(methods, path) {
        if(!masterPaths[path]){ // se nel master non c'è il nuovo path, lo copio interamente
            masterPaths[path] = methods
        } else {
            _.forOwn(methods, function(methodValue, httpMethod) {
                if(!masterPaths[path][httpMethod]){
                    masterPaths[path][httpMethod] = methodValue
                } else {
                    throw new Error(`Duplicate path ${path} ${httpMethod}`)
                }
            });
        }
    });

    return masterPaths
}

function deepMergeComponents(masterComponents, newComponents){
    _.forOwn(newComponents, function(componentValue, componentName) {
        if(!masterComponents[componentName]){ // se nel master non c'è il nuovo component, lo copio interamente
            masterComponents[componentName] = componentValue
        } else {
            // compare if method differ
            const masterComponentValue = JSON.stringify(masterComponents[componentName])
            const newComponentValue = JSON.stringify(componentValue)

            if(masterComponentValue!==newComponentValue){
                throw new Error(`Component ${componentName} differ`)
            }
        }
    });

    return masterComponents
}

function mergeExternalFilesForBundle(inputFiles, outputFile){
    const fileContent = fs.readFileSync(inputFiles[0], 'utf-8')

    const masterDoc = yaml.load(fileContent);

    for(let i=1; i<inputFiles.length; i++){
        const newFileContent = fs.readFileSync(inputFiles[i], 'utf-8')
        const newDoc = yaml.load(newFileContent);
        masterDoc.paths = deepMergePaths(masterDoc.paths, newDoc.paths)
        masterDoc.components.parameters = deepMergeComponents(masterDoc.components.parameters, newDoc.components.parameters)        
        masterDoc.components.schemas = deepMergeComponents(masterDoc.components.schemas, newDoc.components.schemas)        
    }

    fs.writeFileSync(outputFile, yaml.dump(masterDoc))
}

module.exports = {
    filterApiDocByPath,
    removePathPrefix,
    createFilteredOpenApi,
    mergeExternalFilesForBundle
}