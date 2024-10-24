FROM node:lts-alpine3.17@sha256:984d5610f7f2440171e01a6cf2619ead898fe8908827dab10d331da174dc8e53

## Install patch
RUN apk update && apk add git

# - Install base tools.
#   This is a time consuming task. I prefer have it as first step to maximize 
#   docker build cache hits during development
RUN npm install -g @redocly/cli@1.0.2 && npm install -g @stoplight/spectral-cli@6.10.1

# - Create app directory
RUN mkdir -p /usr/local/app

# - Install npm libraries
#   Probably npm library change less frequently than application source code.
#   Install them before copy application code inside image can accelerate 
#   docker build during development 
COPY ./src/package.json ./src/package-lock.json /usr/local/app/src/
RUN cd /usr/local/app/src && npm install

# - Copy application code.
COPY ./src /usr/local/app/src

# - Changes to entrypoint.sh are infrequent but related docker build operations 
#   are very quick
COPY entrypoint.sh /usr/local/app/entrypoint.sh
RUN chmod +x /usr/local/app/entrypoint.sh


CMD [ "/bin/sh", "/usr/local/app/entrypoint.sh" ]
