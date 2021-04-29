'use strict'

const logger = require('logino')
const orequest = require('@paylike/request')

const defaultClientId = `js-c-1`
let counter = 0

module.exports = (opts = {}) => {
	const {
		hosts = {api: 'b.paylike.io', vault: 'vault.paylike.io'},
		clientId = defaultClientId,
		log = () => undefined,
		request = orequest,
		timeout = 10000,
		clock = {
			setTimeout: (...args) => setTimeout(...args),
			clearTimeout: (...args) => clearTimeout(...args),
		},
		retryAfter = defaultRetryAfter,
	} = opts
	const defaults = {
		log,
		fetch: opts.fetch,
		timeout,
		clock,
		clientId,
		retryAfter,
	}

	return {
		RateLimitError: request.RateLimitError,
		TimeoutError: request.TimeoutError,
		ServerError: request.ServerError,
		ResponseError: request.ResponseError,

		tokenize: (type, value, opts) =>
			first(hosts.vault, {
				version: 1,
				data: {type, value},
				...defaults,
				...opts,
			}),
		payments: {
			create: (payment, hints, challengePath, opts) =>
				first(`${hosts.api}${challengePath || '/payments'}`, {
					version: 1,
					data: {...payment, hints},
					...defaults,
					...opts,
				}),
		},
	}

	function first(endpoint, {log: olog, retryAfter, ...opts}) {
		const id = counter++
		const log = logger(olog).create(id)
		return retry(
			() => request(endpoint, {log, ...opts}).first(),
			(err, attempts) => {
				const shouldRetryAfter = retryAfter(err, attempts)
				log({
					t: 'request failed',
					attempts,
					retryAfter: shouldRetryAfter,
					err,
				})
				return shouldRetryAfter
			}
		)
	}

	function retry(fn, retryAfter, attempts = 1) {
		return fn().catch((err) => {
			const shouldRetryAfter = retryAfter(err, attempts)
			if (!Number.isInteger(shouldRetryAfter)) throw err

			return new Promise((resolve) =>
				clock.setTimeout(
					() => resolve(retry(fn, retryAfter, attempts + 1)),
					shouldRetryAfter
				)
			)
		})
	}

	function defaultRetryAfter(err, attempts) {
		if (
			attempts > 10 ||
			// a ResponseError is final
			err instanceof request.ResponseError
		) {
			return false
		} else if (err.retryAfter !== undefined) {
			return err.retryAfter
		} else {
			switch (attempts) {
				case 1:
					return 0
				case 2:
					return 100
				case 3:
					return 2000
				default:
					return 10000
			}
		}
	}
}
