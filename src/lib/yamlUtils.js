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

                    // compare if method differ
                    const masterPathMethod = JSON.stringify(masterPaths[path][httpMethod])
                    const newPathMethod = JSON.stringify(methodValue)

                    if(masterPathMethod!==newPathMethod){
                        console.debug('main path method', masterPathMethod)
                        console.debug('new path method', newPathMethod)
                        throw new Error(`Paths ${path} ${httpMethod} differ`)
                    }

//                    throw new Error(`Duplicate path ${path} ${httpMethod}`)
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
                console.debug('main component value', masterComponentValue)
                console.debug('new component value', newComponentValue)
                throw new Error(`Component ${componentName} differ`)
            }
        }
    });

    return masterComponents
}

function mergeTags(masterTagsList, newTagsList){
    for(let i=0; i<newTagsList.length; i++){
        const existingTag = _.find(masterTagsList, (t) => {
            return t.name === newTagsList[i].name
        })

        if(!existingTag){
            masterTagsList.push(newTagsList[i])
        } else {
            if(newTagsList[i].description!==existingTag.description){
                console.debug("Tags "+newTagsList[i].name+" differ", {
                    main: existingTag.description,
                    new: newTagsList[i].description
                })
                throw new Error("Tags "+newTagsList[i].name+" differ")
            }
        }
    }

    return masterTagsList
}

function mergeExternalFilesForBundle(inputFiles, outputFile){
    const fileContent = fs.readFileSync(inputFiles[0], 'utf-8')

    const masterDoc = yaml.load(fileContent);

    for(let i=1; i<inputFiles.length; i++){
        let inputFilePath = inputFiles[i]
        let mergeDescription = false
        if(_.isObject(inputFiles[i])){
            inputFilePath = inputFiles[i].path
            mergeDescription = inputFiles[i].mergeDescription
        }
        const newFileContent = fs.readFileSync(inputFilePath, 'utf-8')
        const newDoc = yaml.load(newFileContent);
        masterDoc.paths = deepMergePaths(masterDoc.paths, newDoc.paths)
        masterDoc.components.parameters = deepMergeComponents(masterDoc.components.parameters, newDoc.components.parameters)        
        masterDoc.components.schemas = deepMergeComponents(masterDoc.components.schemas, newDoc.components.schemas)    
        if(newDoc.tags){
            masterDoc.tags = mergeTags(masterDoc.tags, newDoc.tags)        
        }    

        if(mergeDescription){
            masterDoc.description = masterDoc.description + '<br/>' + newDoc.description
        }
    }

    fs.writeFileSync(outputFile, yaml.dump(masterDoc))
}

module.exports = {
    filterApiDocByPath,
    removePathPrefix,
    createFilteredOpenApi,
    mergeExternalFilesForBundle
}