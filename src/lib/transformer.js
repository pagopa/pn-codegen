const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs')

async function internalToExternal(inputFile, outputFile){
    const command = `cat ${inputFile} | sed -e '/.*<details no-external>.*/,/<\\/details>/ d' | grep -v "# NO EXTERNAL" | grep -v "# NOT YET IMPLEMENTED" | sed -e '/# ONLY EXTERNAL/s/^#//' > ${outputFile}`
    
    console.log('internal to external', command)
    const { stdout, stderr } = await exec(command);

    if (stderr) {
        console.error(`internal to external error: ${stderr}`);
    }
    console.log(`${stdout}`);
}

async function makeBundle(inputFile, outputFile, fromMerge = false, skipLint = false){

    const options = []
    if(fromMerge){
        options.push('-k')
    }

    const redoclyCommand = `redocly bundle ${inputFile} ${options.join(' ')} --output ${outputFile}`
    const lintCommand = `spectral lint -r https://github.com/italia/api-oas-checker-rules/releases/latest/download/spectral.yml ${outputFile}`

    console.log(redoclyCommand)
    const { stdout, stderr } = await exec(redoclyCommand);

    if (stderr) {
        console.error(`redocly error: ${stderr}`);
    }
    
    if(!skipLint){
        console.log(lintCommand)
        const { lintStdout, lintStderr } = await exec(lintCommand);
    
        if (lintStderr) {
            console.error(`lint error: ${lintStderr}`);
        }
    }
    
}

async function lint(outputFile){
    const lintCommand = `spectral lint -r https://github.com/italia/api-oas-checker-rules/releases/latest/download/spectral.yml ${outputFile}`

    console.log(lintCommand)
    const { lintStdout, lintStderr } = await exec(lintCommand);

    if (lintStderr) {
        console.error(`lint error: ${lintStderr}`);
    }
}

async function mergeYaml(inputFile, outputFile){
    const { stdout, stderr } = await exec(`redocly bundle ${inputFile} -o ${outputFile}`);

    if (stderr) {
        console.error(`error: ${stderr}`);
    }
}

async function removeIntFormat(inputFile){
    const command = `sed -i -e '/format: int32/ d' -e '/format: int64/ d' ${inputFile}`

    const { stdout, stderr } = await exec(command);

    if (stderr) {
        console.error(`redocly error: ${stderr}`);
    }

}

async function updateIntegerType(inputFile){
    const command = `sed -i -e 's/type: *integer/type: number/' ${inputFile}`

    const { stdout, stderr } = await exec(command);

    if (stderr) {
        console.error(`redocly error: ${stderr}`);
    }

}

async function copyYamlFiles(sourceFolder, destFolder, inclusionList = []){
    if( fs.existsSync(sourceFolder) ) {
        fs.readdirSync(sourceFolder).forEach(file => {
            if(file.endsWith('.yaml') && (inclusionList.length==0 || inclusionList.indexOf(file)>=0)){
                fs.copyFileSync(sourceFolder+'/'+file, destFolder+'/'+file)
            }
        });
    }
}

async function applyPatch(baseFolder, patchFile){
    const command = `(cd microsvc && git apply ${baseFolder.replace('microsvc/','')}/${patchFile} -v)`
    
    console.log('applying patch', command)
    const { stdout, stderr } = await exec(command);

    if (stderr) {
        console.error(`applying patch error: ${stderr}`);
    }
    console.log(`${stdout}`);
}

module.exports = {
    internalToExternal,
    makeBundle,
    mergeYaml,
    removeIntFormat,
    updateIntegerType,
    copyYamlFiles,
    lint,
    applyPatch
}