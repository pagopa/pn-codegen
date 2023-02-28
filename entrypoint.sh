#!/bin/bash

CONFIG_FILE_PATH=microsvc/codegen/config.json
if [[ ! -f "${CONFIG_FILE_PATH}" ]]; then
    echo "File ${CONFIG_FILE_PATH} doesn't exist"
    exit 1
fi


echo $CONFIG_FILE_PATH
node src/index.js