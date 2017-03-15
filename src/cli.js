#! /usr/bin/env node
/* eslint-disable no-console */

const program = require('commander');
const chalk = require('chalk');
const Deployer = require('.');
const pkg = require('../package.json');

// Describe program options
program
.version(pkg.version)
.usage('[options] <configFile?>')
.option('-a, --app [string]', 'Heroku application name', null)
.option('-t, --token [string]', 'Heroku API token', null)
.option('-d, --src-dir [dirname]', 'Path to the application source code', null)
.option('--app-only', 'Deploy application without updating its configuration')
.option('--config-only', 'Update the application configuration without deploying code');

// Parse passed arguments
program.parse(process.argv);

// Construct converters options
const opts = {};
if (program.args[0]) {
    opts.configFile = program.args[0];
}
if (program.app) {
    opts.app = program.app;
}
if (program.token) {
    opts.token = program.token;
}
if (program.srcDir) {
    opts.srcDir = program.srcDir;
}

// Get a Deployer
let deployer;
try {
    deployer = new Deployer(opts);
}
catch (err) {
    console.log(chalk.red(err.message));
    process.exit(1);
}

// Launch deployer
if (program.appOnly) {
    deployer.deployApp();
} else if (program.configOnly) {
    deployer.deployConfig();
} else {
    deployer.deploy();
}
