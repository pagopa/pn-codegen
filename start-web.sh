#/bin/sh
docker run --rm -it -e CODEGEN_CONFIG_FILE=codegen.json -v openapi:/usr/src/app/openapi --name=pn-openapi-processor pagopa/pn-openapi-processor 