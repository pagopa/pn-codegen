const fs = require('fs')

function checkBundles(openapiFolder, bundleNames = []){
    for(let i=0; i<bundleNames.length; i++){
        const bundleName = bundleNames[i]
        if(!fs.existsSync(openapiFolder+'/'+bundleName)){
            throw new Error('File '+bundleName+' doesn\t exist')
        }
    }

    // check if other files with bundle exists in folder
    const unexpectedBundleFiles = fs.readdirSync(openapiFolder).filter(fn => fn.endsWith('-bundle.yaml') && bundleNames.indexOf(fn)<0)

    if(unexpectedBundleFiles.length>0){
        throw new Error('These bundles were not expected: '+unexpectedBundleFiles.join(', '))
    }

    console.log('Bundle names check completed!')
}

module.exports = {
    checkBundles
}