#! /bin/sh
docker run --rm -it -v ${PWD}:/usr/local/app/microsvc --name=pn-codegen pagopa/pn-codegen
