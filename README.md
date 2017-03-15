# heroku-deployer

Node module and CLI package to easily deploy an Heroku application and/or update its configuration.

The main advantage of using this package is the ability to deploy an app using only a JSON configuration file.

## Install

```bash
$ npm i heroku-deployer
```

## CLI

```bash
$ heroku-deployer <path-to-env.json> -a <my-heroku-app> -t <my-heroku-token> -d <path-to-source-code>
```

Full list of options:
```bash
Usage: heroku-deployer [options] <configFile?>

  Options:

    -h, --help               output usage information
    -V, --version            output the version number
    -a, --app [string]       Heroku application name
    -t, --token [string]     Heroku API token
    -d, --src-dir [dirname]  Path to the application source code
    --app-only               Deploy application without updating its configuration
    --config-only            Update the application configuration without deploying code
```

## Node module

### Use

```js
const Deployer = require('heroku-deployer');
const deployer = new Deployer({
    // ...
});

deployer.deploy()
.then(() => {
    console.log('App has been successfully deployed to Heroku with updated configuration!');
});
```

### Parameters

All parameters to use `heroku-deployer` can be passed directly in the `opts` hash when creating a new instance and/or
using a JSON configuration file. However, parameters passed directly in the `opts` hash will take precedence over the values
in the configuration file.

```js
const opts = {
    // -- Required opts
    // -- Must be passed directly or exist in configFile
    // Heroku App name
    app: 'my-heroku-app',
    // Heroku API token
    token: 'my-heroku-token',
    // Path to source code to bundle and deploy
    srcDir: '<path-to-source-code>',

    // -- Optional opts with default values
    // Configuration file to use for values instead of passing each parameter
    configFile: '<path-to-config-file.json>',
    // Version to use for Heroku build
    // Not used if using the <useGitVersion> parameter
    buildVersion: null,
    // List of buildpacks to update passed as Strings
    // Example: buildpacks: []
    buildpacks: [],
    // Heroku environment variables hash
    // All missing previously set keys will be deleted by the config update
    env: {},
    // Force deployment even though Heroku status is not all green
    force: false,
    // Used globs to create the app bundle
    // If passed empty, no files will be copied
    // Be sure to exclude the tmp directory and sub-directories
    srcGlobs: [ '**/*', '!tmp', '!tmp/**/*' ],
    // Use srcDir last commit as build version
    useGitVersion: true
};
```

Those two code snippets will then do exactly the same:

```js
const Deployer = require('heroku-deployer');
const deployer = new Deployer({
    app: 'my-heroku-app',
    token: 'my-heroku-token',
    srcDir: '<path-to-source-code>',
    buildVersion: 'v1',
    buildpacks: [
        'https://github.com/heroku/heroku-buildpack-nodejs.git',
        'https://github.com/heroku/heroku-buildpack-nginx.git'
    ],
    env: {
        FOO: 'BAR'
    }
});

deployer.deploy()
.then(() => {});
```

```js
// env.json
// {
//     "app": "my-heroku-app",
//     "token": "my-heroku-token",
//     "srcDir": "<path-to-source-code>",
//     "buildVersion": "v1",
//     "buildpacks": [
//         "https://github.com/heroku/heroku-buildpack-nodejs.git",
//         "https://github.com/heroku/heroku-buildpack-nginx.git"
//     ],
//     "env": {
//         "FOO": "BAR"
//     }
// }

const Deployer = require('heroku-deployer');
const deployer = new Deployer({
    configFile: './env.json'
});

deployer.deploy()
.then(() => {});
```

### Simple API

All instance functions return [bluebird](https://github.com/petkaantonov/bluebird/) Promises.

**deployer.deploy()**

Deploy the whole application to Heroku and updates its configuration using the `env` parameter.
Be sure to always pass your whole environment variables list since all missing values will be unset on Heroku.

**deployer.deployApp()**

Deploy the whole application to Heroku without updating its configuration.

**deployer.deployConfig()**

Update the application's configuration using the `env` parameter without deploying the app.
Be sure to always pass your whole environment variables list since all missing values will be unset on Heroku.

### Advanced API

**deployer.checkHerokuStatus()**

Logs current status and fail if Heroky status is not all green.
Used to check heroku status before deploying.

**deployer.packBundle()**

Copies files from `srcDir` to `${srcDir}/tmp/app-bundle` directory using `srcGlobs` options then creates a `bundle.tgz` file in `${srcDir}/tmp`.
The copied files in `${srcDir}/tmp/app-bundle` are not deleted after this call.

**deployer.clearBundleDir()**

Deletes both the `${srcDir}/tmp/app-bundle` directory and its associated `${srcDir}/tmp/bundle.tgz` file.

**deployer.updateBuildpacks()**

Updates the list of used buildpacks for the Heroku application using the list provided as parameter.

**deployer.createSource()**

Create a new source endpoint for the app on Heroku and sets `deployer.sourceBlob` to the sub `source_blob` object returned by the Heroku API.
See https://devcenter.heroku.com/articles/platform-api-reference#source for more details.

**deployer.uploadSource()**

Upload the generated `${srcDir}/tmp/bundle.tgz` file to the Heroku source PUT URL.
Calls to `deployer.packBundle()` and `deployer.createSource()` are required before this action.

**deployer.getGitVersion()**

Use `srcDir` last Git commit SHA as the Heroku build version. If the `buildVersion` parameter was passed, this overrides its value.

**deployer.createHerokuBuild()**

Triggers a new Heroku build using the uploaded source file and the `buildVersion` parameter if any, or the last Git SHA if `deployer.getGitVersion()` has been called. The Heroku build logs are then streamed to the console.

**deployer.checkBuildStatus()**

Check the status of the build triggered by `deployer.createHerokuBuild()`. Fails if the build was not successful.
