# pn-codegen

## BUILD immagine docker

Eseguire il comando `./build.sh` 


## Esecuzione container

Eseguire il comando dalla cartella del progetto (ad es. pn-delivery):

`docker run --rm -it -v ${PWD}:/usr/src/app/microsvc --name=pn-openapi-processor pagopa/pn-openapi-processor`
