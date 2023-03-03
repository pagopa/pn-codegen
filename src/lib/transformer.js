const util = require('util');
const exec = util.promisify(require('child_process').exec);

async function internalToExternal(openapiFolder, inputFile, outputFile){
    const command = `cat ${openapiFolder}/${inputFile} | sed -e '/.*<details no-external>.*/,/<\\/details>/ d' | grep -v "# NO EXTERNAL" | grep -v "# NOT YET IMPLEMENTED" | sed -e '/# ONLY EXTERNAL/s/^#//' > ${openapiFolder}/${outputFile}`
    
    console.log('internal to external', command)
    const { stdout, stderr } = await exec(command);

    if (stderr) {
        console.error(`internal to external error: ${stderr}`);
    }
    console.log(`${stdout}`);
}

async function makeBundle(openapiFolder, inputFile, outputFile){

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

async function mergeYaml(inputFile, outputFile){
    const { stdout, stderr } = await exec(`redocly bundle ${inputFile} -o ${outputFile}`);

    if (stderr) {
        console.error(`error: ${stderr}`);
    }
}

module.exports = {
    internalToExternal,
    makeBundle,
    mergeYaml
}