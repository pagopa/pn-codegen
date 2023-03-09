#! /bin/sh
docker run --rm -it -v ${PWD}:/usr/local/app/microsvc --name=pn-openapi-processor pagopa/pn-openapi-processor 
