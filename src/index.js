/* eslint-disable no-console */

const Promise = require('bluebird');
const jetpack = require('fs-jetpack');
const chalk = require('chalk');
const execPromise = Promise.promisify(require('child_process').exec, { multiArgs: true });
const request = require('request');
const requestPromise = Promise.promisify(request, { multiArgs: true });
const Heroku = require('heroku-client');

const HEROKU_PLATFORM_STATUS_URL = 'https://status.heroku.com/api/v3/current-status';

class Deployer {

    /**
     * Get a new Deployer
     * @param {Object} opts
     */
    constructor(opts = {}) {
        // Try to load <configFile> if passed
        let configFile = {};
        if (opts.configFile) {
            try {
                configFile = require(opts.configFile);
            } catch (err) {
                throw new Error(`Failed to load configuration file: ${err.message}`);
            }
        }

        // Initialize configuration and check values
        this.config = Object.assign({
            buildVersion: null,
            buildpacks: [],
            env: {},
            force: false,
            srcGlobs: [ '**/*', '!tmp', '!tmp/**/*' ],
            useGitVersion: true
        }, configFile, opts);

        // Set base informations for Heroku
        this.app = this.config.app;
        if (!this.app) {
            throw new Error('"app" parameter should be passed in configuration file or as an argument');
        }
        this.token = this.config.token;
        if (!this.token) {
            throw new Error('"token" parameter should be passed in configuration file or as an argument');
        }
        // Set base files informations
        if (!this.config.srcDir) {
            throw new Error('"srcDir" parameter should be passed in configuration file or as an argument');
        }
        this.srcDir = jetpack.dir(this.config.srcDir);

        // tmp directory to create bundle file
        this.tmpDir = this.srcDir.dir('tmp');
        this.bundleDir = this.tmpDir.dir('app-bundle', { empty: true });
        this.bundleTarFile = this.tmpDir.path('bundle.tgz');

        // Internals
        this.configVars = {};
        this.sourceBlob = null;
        this.build = null;

        // Initialize Heroku client
        this.client = new Heroku({
            token: this.token
        });
    }

    /**
     *  Check heroku status before deploying
     *  @return {Promise}
     */
    checkHerokuStatus() {
        return requestPromise(HEROKU_PLATFORM_STATUS_URL, {
            json: true
        })
        .spread((response, status) => {
            let down = false;
            console.log('Heroku status:');

            Object.entries(status.status)
            .forEach(([ _status, color ]) => {
                console.log('   -', chalk[color](_status));

                if (color != 'green') {
                    down = true;
                }
            });

            if (down) {
                throw new Error('Heroku status is not all green, use --force-deploy to deploy anyway');
            }
        });
    }

    /**
     * Create a new tar.gz for the app
     * @return {Promise}
     */
    packBundle() {
        console.log(`Creating deployment bundle in ${this.bundleDir.cwd()}...`);

        // Copy app code source to bundle dir
        return Promise.resolve()
        .then(() => jetpack.copyAsync(this.srcDir.cwd(), this.bundleDir.cwd(), {
            matching: this.config.srcGlobs,
            overwrite: true
        }))
        // Create tar.gz from app code
        .then(() => execPromise(`tar -cf ${this.bundleTarFile} ./`, {
            cwd: this.bundleDir.cwd()
        }));
    }

    /**
     * Clear the tmp bundle directory
     * @return {Promise}
     */
    clearBundleDir() {
        console.log(`Deleting temporary bundle directory ${this.bundleDir.cwd()}...`);

        return Promise.resolve()
        .then(() => jetpack.remove(this.bundleDir.cwd()))
        .then(() => jetpack.remove(this.bundleTarFile));
    }

    /**
     * Update application's buildpacks
     * @return {Promise}
     */
    updateBuildpacks() {
        return Promise.resolve()
        .then(() => {
            if (!this.config.buildpacks.length) {
                console.log('No buildpacks detected in config, skipping...');
                return;
            }

            console.log('Updating Application buildpacks...');
            return this.client.put(`/apps/${this.app}/buildpack-installations`, {
                body: {
                    'updates': this.config.buildpacks.map(buildpack => ({ buildpack }))
                }
            });
        });
    }

    /**
     * Create the app source
     * Sets deployer.sourceBlob as the Heroku "source_blob" object, i.e.:
     *  {
     *      "get_url": "...",
     *      "put_url": "..."
     *  }
     * https://devcenter.heroku.com/articles/platform-api-reference#source
     * @return {Promise}
     */
    createSource() {
        return Promise.resolve()
        .then(() => {
            console.log(`Creating new source for ${this.app}...`);
            return this.client.post('/sources');
        })
        .then((source) => {
            this.sourceBlob = source.source_blob;
        });
    }

    /**
     * Upload generated bundle.tgz to new source PUT URL
     * @return {Promise}
     */
    uploadSource() {
        console.log('Uploading source to Heroku PUT URL...');
        const body = jetpack.read(this.bundleTarFile, 'buffer');

        return requestPromise({
            method: 'PUT',
            uri: this.sourceBlob.put_url,
            headers: {
                'Content-Type': '',
                'Content-Length': body.length
            },
            body
        })
        .then((response) => {
            if (
                !response ||
                response.statusCode != 200
            ) {
                throw new Error('Invalid response from heroku s3');
            }
        });
    }

    /**
     * Use SHA of last commit as Heroku build version
     * @return {Promise}
     */
    getGitVersion() {
        console.log('Getting latest GIT revision sha...');
        return execPromise('git rev-parse HEAD', {
            cwd: this.srcDir.cwd()
        })
        .spread((stdout) => {
            this.config.buildVersion = stdout[0].toString().trim();
        });
    }

    /**
     * Create the Heroku build from the uploaded source
     * and stream build's logs to console
     * Sets deployer.build as the "build" object returned by Heroku
     * https://devcenter.heroku.com/articles/platform-api-reference#build-create
     * @return {Promise}
     */
    createHerokuBuild() {
        return Promise.resolve()
        .then(() => {
            const logVersion = this.config.buildVersion ?
                ` with version ${this.config.buildVersion}` :
                '';

            console.log(`Creating new heroku build${logVersion}...`);
            return this.client.post(`/apps/${this.app}/builds`, {
                body: {
                    'source_blob': {
                        'url': this.sourceBlob.get_url,
                        'version': this.config.buildVersion
                    }
                }
            });
        })
        // Take some time...
        .delay(1000)
        // Stream log to console
        .then((build) => {
            this.build = build;

            return new Promise((resolve) => {
                request.get(this.build.output_stream_url, () => {
                    resolve();
                })
                .on('data', (data) => {
                    process.stdout.write(data.toString('utf-8'));
                });
            });
        });
    }

    /**
     * Check that Heroku build was successful
     * @return {Promise}
     */
    checkBuildStatus() {
        return Promise.resolve()
        // Get build from Heroku
        .then(() => this.client.get(`/apps/${this.app}/builds/${this.build.id}`))
        .then((build) => {
            // Build went well
            if (build.status == 'succeeded') {
                console.log(chalk.green(`${this.app} has been successfully deployed to Heroku`));
            }
            // Build failed, show details
            else {
                const err = new Error(`Heroku build failed: ${build ? build.status : 'invalid'}`);
                console.log(build);
                err.showStack = false;
                throw err;
            }
        });
    }

    /**
     * Deploy the full app to Heroku
     * @return {Promise}
     */
    deployApp() {
        console.log(`Deploying Heroku application ${this.app}`);

        return Promise.resolve()
        // Check Heroku status before deploying
        .then(() => {
            if (this.config.force) {
                return;
            }
            return this.checkHerokuStatus();
        })
        // Build a tar.gz
        .then(() => this.packBundle())
        // Create a source
        .then(() => this.createSource())
        // Upload source
        .then(() => this.uploadSource())
        // Update buildpacks
        .then(() => this.updateBuildpacks())
        // Get sha of git repo if needed
        .then(() => {
            if (!this.config.useGitVersion) {
                return;
            }
            return this.getHeadSha();
        })
        // Create new build with this source
        .then(() => this.createHerokuBuild())
        // Take some time...
        .delay(1000)
        // Get final build status, Fail if build has failed
        .then(() => this.checkBuildStatus())
        // Finally, clear bundle tmp directory
        .then(() => this.clearBundleDir());
    }

    /**
     * Fetch current application config vars from Heroku
     * Sets deployer.configVars from Heroku response
     * https://devcenter.heroku.com/articles/platform-api-reference#config-vars
     * @return {Promise}
     */
    getConfigVars() {
        console.log('Fetching current configuration from Heroku...');
        return Promise.resolve()
        .then(() => this.client.get(`/apps/${this.app}/config-vars`))
        .then((configVars) => {
            this.configVars = configVars;
        });
    }

    /**
     * Update configuration, without deploying application
     * @return {Promise}
     */
    deployConfig() {
        console.log('Updating and deploying configuration to Heroku...');
        return this.getConfigVars()
        .then(() => {
            const diff = {};

            // Create diff of added/modified
            Object.entries(this.config.env).forEach(([ key, value ]) => {
                if (this.configVars[key] != value) {
                    diff[key] = value;
                }
            });

            // Create diff for removed
            Object.entries(this.configVars).forEach(([ key, value ]) => {
                if (this.config.env[key] === undefined) {
                    diff[key] = null;
                }
            });

            if (Object.keys(diff).length === 0) {
                console.log(chalk.green('Heroku configuration is up-to-date, skipping...'));
                return;
            }

            // Log update
            console.log('');
            Object.entries(diff).forEach(([ key, value ]) => {
                if (value === null) {
                    console.log(chalk.red('[removed]'), key);
                } else if (this.configVars[key] === undefined) {
                    console.log(chalk.green('[added]'), key, '=', value);
                } else {
                    console.log(chalk.yellow('[modified]'), key, '=', value);
                }
            });

            console.log('');
            console.log('Pushing configuration...');
            const body = diff;
            return this.client.patch(`/apps/${this.app}/config-vars`, {
                body
            });
        });
    }

    /**
     * Deploy the application and update its configuration
     * @return {Promise}
     */
    deploy() {
        return this.deployApp()
        .then(() => this.deployConfig());
    }
}

module.exports = Deployer;
