# pn-codegen

## BUILD immagine locale docker

Eseguire il comando `./build.sh` 


## Esecuzione container da immagine locale

Eseguire il comando presente nel file [start-local.sh](start-local.sh) dalla cartella del microservizio per il quale si intende generare i file OpenApi (ad es. pn-delivery).

## Esecuzione container da immagine ufficiale

Posizionarsi nella root folder del progetto per il quale si vuole generare il codice, ad es. pn-delivery.

Eseguire il comando `./mvnw org.apache.maven.plugins:maven-antrun-plugin:run@init-scripts`

E' possibile personalizzare l'esecuzione con i seguenti parametri:
- pagopa.codegen.skipdownload: se impostato, non verrà scaricato il file [start.sh](start.sh) e verrà utilizzato quello presente localmente al progetto al path `scripts/openapi/generate-code.sh` 
- pagopa.codegen.skipdownload: se impostato, non verrà eseguito il file `scripts/openapi/generate-code.sh` 
- pagopa.codegen.version: se impostato, verrà sovrascritto il tag dell'immagine ufficiale di pn-codegend a scaricare ed eseguire; il default è impostato nel `pom.xml` del progetto `pn-parent`.