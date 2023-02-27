#!/bin/bash

OPENAPI_FOLDER="openapi"
if [[ -z "${CODEGEN_CONFIG_FILE}" ]]; then
    echo "Variable CODEGEN_CONFIG_FILE is not set"
    exit 1
fi

if [[ ! -d "${OPENAPI_FOLDER}" ]]; then
    echo "Folder ${OPENAPI_FOLDER} doesn't exist"
    exit 1
fi

if [[ ! -f "${OPENAPI_FOLDER}/${CODEGEN_CONFIG_FILE}" ]]; then
    echo "File ${OPENAPI_FOLDER}/${CODEGEN_CONFIG_FILE} doesn't exist"
    exit 1
fi


echo $CODEGEN_CONFIG_FILE
node src/index.js $OPENAPI_FOLDER $CODEGEN_CONFIG_FILE