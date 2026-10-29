# pn-codegen

## WORKFLOW Ufficiale

### Quickstart
Posizionarsi nella root del progetto ed eseguire lo script: 
`./mvnw org.apache.maven.plugins:maven-antrun-plugin:run@init-scripts` 

Successivamente eseguire:
`./scripts/generate-code.sh`

### Parametri
Se si vuole anche eseguire lo script oltre che generarlo:

`./mvnw org.apache.maven.plugins:maven-antrun-plugin:run@init-scripts -Dpagopa.codegen.exec=true`

Se si vuole eseguire lo script senza generarne una nuova copia:

`./mvnw org.apache.maven.plugins:maven-antrun-plugin:run@init-scripts -Dpagopa.codegen.nocopy=true`

### Personalizzazione tag
Nota: è possibile anche fornire un tag di pn-codegen tramite argomento, ad es.:
`./scripts/generate-code.sh v01.00.01`


## WOFKFLOW Locale

### BUILD immagine docker

Eseguire il comando `./build.sh` 

### Esecuzione container

Eseguire il comando presente nel file [start.sh](start.sh) dalla cartella del microservizio per il quale si intende generare i file OpenApi (ad es. pn-delivery).

### Policy IAM dai tag OpenAPI

Per abilitare la generazione delle policy, aggiungere `generatePolicies: true`
alla singola regola `openapi` di `codegen/config.json`, per esempio:

```json
{
  "openapi": [
    {
      "intendedUsage": "WEB",
      "servicePath": "bff",
      "generatePolicies": true,
      "openapiFiles": ["api-internal-pn-bff-pa-notifications.yaml"]
    }
  ]
}
```

L'elenco dei file nell'esempio e ridotto: mantenere tutti gli input gia presenti
nella configurazione del componente.

- `false` o proprieta assente: nessuna generazione o rimozione di policy;
  la normale generazione OpenAPI resta invariata.
- Il valore deve essere booleano; `true` non e compatibile con
  `skipAWSGeneration`.
- Le policy derivano dalle OpenAPI AWS appena generate dalle regole abilitate,
  dopo l'eventuale `bundlePatch`. I path sono quindi senza `servicePath`.
- Per ogni tipo presente in `x-pn-allowed-cx-types` delle operazioni viene scritto
  `docs/openapi/policies/generated/<cxType minuscolo>Policy.json`.
  I tipi riconosciuti sono `PA`, `PG`, `PF`, `BS`, `PT`, ma **non** costituiscono
  un elenco di file obbligatori: senza tag `PT` non viene prodotto `ptPolicy.json`,
  nemmeno con Deny.
- I tag devono essere array di tipi riconosciuti; valori sconosciuti o malformati
  fanno fallire la generazione. Tag assente o array vuoto non concedono accesso.
- Ogni policy include tutte le risorse ammesse per quel tipo nelle regole
  abilitate, ordinate e senza duplicati. I parametri `{param}` diventano `*`;
  `x-amazon-apigateway-any-method` usa `*` come metodo.
- Gli ARN mantengono i placeholder `{region}`, `{awsAccountId}`, `{restApiId}`,
  `{stage}` per il consumatore. Non e richiesto accesso ad AWS.
- La rigenerazione rimuove i soli file dei tipi riconosciuti non piu presenti.
  Gli altri file nella directory non vengono rimossi. Tutti gli input sono
  validati prima di scrivere le policy; gli errori di I/O fanno fallire il
  processo e richiedono una rigenerazione completa prima di usare gli artefatti.

Non modificare manualmente i JSON: versionarli nel componente insieme alle
OpenAPI e alla configurazione che li produce.

### Test locali

Con Node.js 18 o successivo, dalla root di pn-codegen:

```bash
npm --prefix src ci
npm --prefix src test
```

I test non rigenerano o modificano il BFF. La build Docker esegue anche questi test.

### Generare il BFF con l'immagine locale

1. Dalla root di pn-codegen, costruire un'immagine con tag locale dedicato
   (non pubblica nulla):

   ```bash
   docker build -t pn-codegen:PN-22136 .
   ```

2. Nel checkout BFF da rigenerare, impostare `generatePolicies: true` sulla
   regola `WEB/bff` di `codegen/config.json`, mantenendo gli input esistenti.
   Lasciare la regola `PUBLIC/location` disabilitata.

3. Dalla root di quel checkout BFF, eseguire:

   ```bash
   docker run --rm \
     --mount "type=bind,source=$(pwd),target=/usr/local/app/microsvc" \
     pn-codegen:PN-22136
   ```

   Il bind mount e in scrittura: il comando aggiorna gli artefatti del checkout
   BFF, comprese le policy, e rimuove le policy generate obsolete. Usare un
   checkout di lavoro dedicato o verificare prima le modifiche locali.
   Non usare questo comando su una directory generica o sul solo pn-codegen.

4. Controllare il risultato:

   ```bash
   git diff -- codegen/config.json docs/openapi
   git status --short -- docs/openapi/policies/generated
   ```

   `git status` mostra anche i nuovi file non ancora tracciati. Ripetendo il
   comando Docker con gli stessi input, gli artefatti devono restare identici.
   Il container deve terminare con codice zero prima di utilizzare i risultati.

Questa procedura non richiede un nuovo tag remoto o una modifica del POM BFF:
usa direttamente l'immagine appena costruita. L'adozione tramite
`pagopa.codegen.version` e un passaggio successivo, dopo la disponibilita
dell'immagine ufficiale. La build richiede rete per le dipendenze; la generazione
puo richiederla per resolver OpenAPI, bundle e lint gia previsti dal codegen.
