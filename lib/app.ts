/**
 * @license
 * Copyright 2019 Balena Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { stripIndent } from 'common-tags';

import { exitWithExpectedError } from './utils/patterns';

export interface AppOptions {
	// Prevent the default behaviour of flushing stdout after running a command
	noFlush: boolean;
}

/**
 * Simple command-line pre-parsing to choose between oclif or Capitano.
 * @param argv process.argv
 */
function routeCliFramework(argv: string[], options: AppOptions): void {
	if (process.env.DEBUG) {
		console.log(
			`[debug] original argv0="${process.argv0}" argv=[${argv}] length=${
				argv.length
			}`,
		);
	}
	const cmdSlice = argv.slice(2);

	// Look for commands that have been deleted, to print a notice
	checkDeletedCommand(cmdSlice);

	if (cmdSlice.length > 0) {
		// convert 'balena --version' or 'balena -v' to 'balena version'
		if (['--version', '-v'].includes(cmdSlice[0])) {
			cmdSlice[0] = 'version';
		}
		// convert 'balena --help' or 'balena -h' to 'balena help'
		else if (['--help', '-h'].includes(cmdSlice[0])) {
			cmdSlice[0] = 'help';
		}
		// convert e.g. 'balena help env add' to 'balena env add --help'
		if (cmdSlice.length > 1 && cmdSlice[0] === 'help') {
			cmdSlice.shift();
			cmdSlice.push('--help');
		}
	}

	const [isOclif, isTopic] = isOclifCommand(cmdSlice);

	if (isOclif) {
		let oclifArgs = cmdSlice;
		if (isTopic) {
			// convert space-separated commands to oclif's topic:command syntax
			oclifArgs = [cmdSlice[0] + ':' + cmdSlice[1], ...cmdSlice.slice(2)];
		}
		if (process.env.DEBUG) {
			console.log(
				`[debug] new argv=[${[
					argv[0],
					argv[1],
					...oclifArgs,
				]}] length=${oclifArgs.length + 2}`,
			);
		}
		return require('./app-oclif').run(oclifArgs, options);
	} else {
		return require('./app-capitano').run(argv);
	}
}

/**
 *
 * @param argvSlice process.argv.slice(2)
 */
function checkDeletedCommand(argvSlice: string[]): void {
	if (argvSlice[0] === 'help') {
		argvSlice = argvSlice.slice(1);
	}
	function replaced(
		oldCmd: string,
		alternative: string,
		version: string,
		verb = 'replaced',
	) {
		exitWithExpectedError(stripIndent`
			Note: the command "balena ${oldCmd}" was ${verb} in CLI version ${version}.
			Please use "balena ${alternative}" instead.
		`);
	}
	function removed(oldCmd: string, alternative: string, version: string) {
		let msg = `Note: the command "balena ${oldCmd}" was removed in CLI version ${version}.`;
		if (alternative) {
			msg = [msg, alternative].join('\n');
		}
		exitWithExpectedError(msg);
	}
	const stopAlternative =
		'Please use "balena ssh -s" to access the host OS, then use `balena-engine stop`.';
	const cmds: { [cmd: string]: [(...args: any) => void, ...string[]] } = {
		sync: [replaced, 'push', 'v11.0.0', 'removed'],
		'local logs': [replaced, 'logs', 'v11.0.0'],
		'local push': [replaced, 'push', 'v11.0.0'],
		'local scan': [replaced, 'scan', 'v11.0.0'],
		'local ssh': [replaced, 'ssh', 'v11.0.0'],
		'local stop': [removed, stopAlternative, 'v11.0.0'],
	};
	let cmd: string | undefined;
	if (argvSlice.length > 1) {
		cmd = [argvSlice[0], argvSlice[1]].join(' ');
	} else if (argvSlice.length > 0) {
		cmd = argvSlice[0];
	}
	if (cmd && Object.getOwnPropertyNames(cmds).includes(cmd)) {
		cmds[cmd][0](cmd, ...cmds[cmd].slice(1));
	}
}

/**
 * Determine whether the CLI command has been converted from Capitano to oclif.
 * Return an array of two boolean values:
 *   r[0] : whether the CLI command is implemented with oclif
 *   r[1] : if r[0] is true, whether the CLI command is implemented with
 *          oclif "topics" (colon-separated subcommands like `env:add`)
 * @param argvSlice process.argv.slice(2)
 */
function isOclifCommand(argvSlice: string[]): [boolean, boolean] {
	// Look for commands that have been transitioned to oclif
	if (argvSlice.length > 0) {
		// balena version
		if (argvSlice[0] === 'version') {
			return [true, false];
		}
		if (argvSlice.length > 1) {
			// balena env add
			if (argvSlice[0] === 'env' && argvSlice[1] === 'add') {
				return [true, true];
			}

			// balena env rm
			if (argvSlice[0] === 'env' && argvSlice[1] === 'rm') {
				return [true, true];
			}
		}
	}
	return [false, false];
}

/**
 * CLI entrypoint, but see also `bin/balena` and `bin/balena-dev` which
 * call this function.
 */
export function run(cliArgs = process.argv, options: AppOptions): void {
	// globalInit() must be called very early on (before other imports) because
	// it sets up Sentry error reporting, global HTTP proxy settings, balena-sdk
	// shared options, and performs node version requirement checks.
	require('./app-common').globalInit();
	return routeCliFramework(cliArgs, options);
}
