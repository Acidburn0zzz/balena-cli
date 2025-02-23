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
import BalenaSdk = require('balena-sdk');
import Promise = require('bluebird');
import * as semver from 'resin-semver';

const balena = BalenaSdk.fromSharedOptions();

interface ImgConfig {
	applicationName: string;
	applicationId: number;
	deviceType: string;
	userId: number;
	username: string;
	appUpdatePollInterval: number;
	listenPort: number;
	vpnPort: number;
	apiEndpoint: string;
	vpnEndpoint: string;
	registryEndpoint: string;
	deltaEndpoint: string;
	mixpanelToken: string;
	wifiSsid?: string;
	wifiKey?: string;

	// props for older OS versions
	connectivity?: string;
	files?: {
		[filepath: string]: string;
	};

	// device specific config props
	deviceId?: number;
	uuid?: string;
	registered_at?: number;

	os?: {
		sshKeys?: string[];
	};
}

export function generateBaseConfig(
	application: BalenaSdk.Application,
	options: {
		version: string;
		appUpdatePollInterval?: number;
		deviceType?: string;
		os?: {
			sshKeys?: string[];
		};
	},
): Promise<ImgConfig> {
	options = {
		...options,
		appUpdatePollInterval: options.appUpdatePollInterval || 10,
	};

	const promise = balena.models.os.getConfig(
		application.app_name,
		options,
	) as Promise<ImgConfig & { apiKey?: string }>;
	return promise.tap(config => {
		// os.getConfig always returns a config for an app
		delete config.apiKey;

		// merge sshKeys to config, when they have been specified
		if (options.os && options.os.sshKeys) {
			// Create config.os object if it does not exist
			config.os = config.os ? config.os : {};
			config.os.sshKeys = config.os.sshKeys
				? [...config.os.sshKeys, ...options.os.sshKeys]
				: options.os.sshKeys;
		}
	});
}

export function generateApplicationConfig(
	application: BalenaSdk.Application,
	options: { version: string; deviceType?: string },
) {
	return generateBaseConfig(application, options).tap(config => {
		if (semver.satisfies(options.version, '<2.7.8')) {
			return addApplicationKey(config, application.id);
		}
		return addProvisioningKey(config, application.id);
	});
}

export function generateDeviceConfig(
	device: BalenaSdk.Device & {
		belongs_to__application: BalenaSdk.PineDeferred;
	},
	deviceApiKey: string | true | null,
	options: { version: string },
) {
	return balena.models.application
		.get(device.belongs_to__application.__id)
		.then(application => {
			const baseConfigOpts = {
				...options,
				deviceType: device.device_type,
			};
			return generateBaseConfig(application, baseConfigOpts).tap(config => {
				if (
					deviceApiKey == null &&
					semver.satisfies(options.version, '<2.0.3')
				) {
					return addApplicationKey(config, application.id);
				}
				return addDeviceKey(config, device.uuid, deviceApiKey || true);
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
