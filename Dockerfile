FROM node:lts-alpine3.17

# Create app directory
WORKDIR /usr/src/app

COPY ./src ./src

COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

RUN cd src && npm install

RUN npm install -g @redocly/cli && npm install -g @stoplight/spectral-cli

CMD [ "/bin/sh", "entrypoint.sh" ]
