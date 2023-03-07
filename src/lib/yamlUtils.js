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


module.exports = {
    filterApiDocByPath,
    removePathPrefix,
    createFilteredOpenApi
}