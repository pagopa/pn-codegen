FROM node:lts-alpine3.17

# Create app directory
RUN mkdir -p /usr/local/app

COPY ./src /usr/local/app/src

COPY entrypoint.sh /usr/local/app/entrypoint.sh

RUN chmod +x /usr/local/app/entrypoint.sh

RUN cd /usr/local/app/src && npm install

RUN npm install -g @redocly/cli && npm install -g @stoplight/spectral-cli

CMD [ "/bin/sh", "/usr/local/app/entrypoint.sh" ]
