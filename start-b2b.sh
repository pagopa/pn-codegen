#/bin/sh
docker run --rm -it -e OPENAPI_FILES=api-internal-b2b-pa-v1.yaml -e SERVICE_PATH=delivery -e INTENDED_USAGE=B2B -v openapi:/usr/src/app/openapi --name=pn-openapi-processor pagopa/pn-openapi-processor 