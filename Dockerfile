FROM node:18-alpine

# Install build tools necessary for node-gyp
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg \
    && python3 -m ensurepip \
    && pip3 install --no-cache --upgrade pip setuptools \
    && npm install -g node-gyp

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY package.json ./
COPY yarn.lock ./

USER node

RUN yarn

COPY --chown=node:node . .

# TODO: These folders probably don't need to exist, and we should be deleting this data after it gets sent to discord anyway
RUN mkdir ./logs
RUN mkdir ./recordings

EXPOSE 3001

CMD npx ts-node ./src/index.ts
