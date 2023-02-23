#!/bin/bash

if [[ -z "${OPENAPI_FILES}" ]]; then
    echo "Variable OPENAPI_FILES is not set"
    exit 1
fi

if [[ -z "${SERVICE_PATH}" ]]; then
    echo "Variable SERVICE_PATH is not set"
    exit 1
fi

if [[ -z "${INTENDED_USAGE}" ]]; then
    echo "Variable INTENDED_USAGE is not set"
    exit 1
fi

if [[ ! -d "./openapi" ]]; then
    echo "Folder ./openapi doesn't exist"
    exit 1
fi

cd ./openapi

openapiFiles=($(echo $OPENAPI_FILES | tr "," "\n"))

b2bFiles=()
externalFiles=""
index=0
for openapiFile in "${openapiFiles[@]}"
do
    externalFile=${openapiFile/internal/external}
    cat $openapiFile \
        | sed -e '/.*<details no-external>.*/,/<\/details>/ d' \
        | grep -v "# NO EXTERNAL" \
        | sed -e '/# ONLY EXTERNAL/s/^#//' \
        > $externalFile

    echo "saved to $externalFile"

    if [[ $INTENDED_USAGE='B2B' ]]; then
        b2bFiles+=($externalFile)
    fi

    if [[ $index>0 ]]; then
        externalFiles="${externalFiles},${externalFile}"
    else
        externalFiles="${externalFile}"
    fi
    index=$index+1
done

if [[ $INTENDED_USAGE='B2B' ]]; then
    listOfFiles=''

    for b2bFile in $b2bFiles
    do
        listOfFiles="${listOfFiles} ${b2bFile}"        
    done

    #redocly bundle $listOfFiles --output api-external-b2b-pa-bundle.yaml
    #spectral lint -r https://italia.github.io/api-oas-checker/spectral.yml api-external-b2b-pa-bundle.yaml
fi

echo $externalFiles
cd ..
node src/index.js openapi $externalFiles $SERVICE_PATH $INTENDED_USAGE