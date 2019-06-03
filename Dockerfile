# This image is used to build a release
FROM node:12

# Defaults when running this container
EXPOSE 80
ENTRYPOINT ["yarn", "run"]
CMD ["build"]

# Packages for building
ENV buildDir /opt/app
WORKDIR ${buildDir}
COPY [".yarnrc", "yarn.lock", "package.json", "${buildDir}/"]
RUN yarn

# Do the build
COPY [".", "${buildDir}"]
ARG BUILD_NUMBER
ENV BUILD_NUMBER ${BUILD_NUMBER:-0}
RUN yarn run build --release
