# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Install build tools necessary for node-gyp
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    ffmpeg \
    && npm install -g node-gyp

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Build the project
RUN npm build

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["npm", "run", "serve"]