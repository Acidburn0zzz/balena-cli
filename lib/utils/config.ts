/*
Copyright 2016-2017 Balena

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import * as fs from 'fs';

import Promise = require('bluebird');
import BalenaSdk = require('balena-sdk');
import deviceConfig = require('resin-device-config');
import * as semver from 'resin-semver';

const balena = BalenaSdk.fromSharedOptions();

function readRootCa(): Promise<string | void> {
	const caFile = process.env.NODE_EXTRA_CA_CERTS;
	if (!caFile) {
		return Promise.resolve();
	}
	return Promise.fromCallback(cb =>
		fs.readFile(caFile, { encoding: 'utf8' }, cb),
	)
		.then(pem => Buffer.from(pem).toString('base64'))
		.catch({ code: 'ENOENT' }, () => {});
}

export function generateBaseConfig(
	application: BalenaSdk.Application,
	options: { version?: string; appUpdatePollInterval?: number },
) {
	if (options.appUpdatePollInterval) {
		options = {
			...options,
			appUpdatePollInterval: options.appUpdatePollInterval * 60 * 1000,
		};
	}

	return Promise.props({
		userId: balena.auth.getUserId(),
		username: balena.auth.whoami(),
		apiUrl: balena.settings.get('apiUrl'),
		vpnUrl: balena.settings.get('vpnUrl'),
		registryUrl: balena.settings.get('registryUrl'),
		deltaUrl: balena.settings.get('deltaUrl'),
		apiConfig: balena.models.config.getAll(),
		rootCA: readRootCa().catch(() => {
			console.warn('Could not read root CA');
		}),
	}).then(results => {
		return deviceConfig.generate(
			{
				application,
				user: {
					id: results.userId,
					username: results.username,
				},
				endpoints: {
					api: results.apiUrl,
					vpn: results.vpnUrl,
					registry: results.registryUrl,
					delta: results.deltaUrl,
				},
				pubnub: results.apiConfig.pubnub,
				mixpanel: {
					token: results.apiConfig.mixpanelToken,
				},
				balenaRootCA: results.rootCA,
			},
			options,
		);
	});
}

export function generateApplicationConfig(
	application: BalenaSdk.Application,
	options: { version?: string },
) {
	return generateBaseConfig(application, options).tap(config => {
		if (semver.satisfies(options.version, '>=2.7.8')) {
			return addProvisioningKey(config, application.id);
		} else {
			return addApplicationKey(config, application.id);
		}
	});
}

export function generateDeviceConfig(
	device: BalenaSdk.Device & {
		belongs_to__application: BalenaSdk.PineDeferred;
	},
	deviceApiKey: string | true | null,
	options: { version?: string },
) {
	return balena.models.application
		.get(device.belongs_to__application.__id)
		.then(application => {
			return generateBaseConfig(application, options).tap(config => {
				if (deviceApiKey) {
					return addDeviceKey(config, device.uuid, deviceApiKey);
				} else if (semver.satisfies(options.version, '>=2.0.3')) {
					return addDeviceKey(config, device.uuid, true);
				} else {
					return addApplicationKey(config, application.id);
				}
			});
		})
		.then(config => {
			// Associate a device, to prevent the supervisor
			// from creating another one on its own.
			config.registered_at = Math.floor(Date.now() / 1000);
			config.deviceId = device.id;
			config.uuid = device.uuid;

			return config;
		});
}

function addApplicationKey(config: any, applicationNameOrId: string | number) {
	return balena.models.application
		.generateApiKey(applicationNameOrId)
		.tap(apiKey => {
			config.apiKey = apiKey;
		});
}

function addProvisioningKey(config: any, applicationNameOrId: string | number) {
	return balena.models.application
		.generateProvisioningKey(applicationNameOrId)
		.tap(apiKey => {
			config.apiKey = apiKey;
		});
}

function addDeviceKey(
	config: any,
	uuid: string,
	customDeviceApiKey: string | true,
) {
	return Promise.try(() => {
		if (customDeviceApiKey === true) {
			return balena.models.device.generateDeviceKey(uuid);
		} else {
			return customDeviceApiKey;
		}
	}).tap(deviceApiKey => {
		config.deviceApiKey = deviceApiKey;
	});
}
