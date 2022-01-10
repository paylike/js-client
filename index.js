'use strict'

const {serializeError} = require('serialize-error')
const orequest = require('@paylike/request')

const defaultClientId = `js-c-1`

module.exports = (opts = {}) => {
	const {
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
	const hosts = {
		api: (opts.hosts && opts.hosts.api) || 'b.paylike.io',
		vault: (opts.hosts && opts.hosts.vault) || 'vault.paylike.io',
		applepay: (opts.hosts && opts.hosts.applepay) || 'applepay.paylike.io',
	}
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
		applepay: {
			tokenize: (paymentData, opts) =>
				first(`${hosts.applepay}/token`, {
					version: 1,
					data: {token: JSON.stringify(paymentData)},
					...defaults,
					...opts,
				}),
			approvePaymentSession: (configurationId, text, opts) =>
				first(`${hosts.applepay}/approve-payment-session`, {
					version: 1,
					data: {
						configurationId,
						text,
						validationURL:
							'https://apple-pay-gateway.apple.com/paymentservices/paymentSession',
					},
					...defaults,
					...opts,
				}).then((r) => r.json.merchantSession),
		},
	}

	function first(endpoint, {log, retryAfter, ...opts}) {
		return retry(
			() => request(endpoint, {log, ...opts}).first(),
			(err, attempts) => {
				const shouldRetryAfter = retryAfter(err, attempts)
				log({
					t: 'request failed',
					attempts,
					retryAfter: shouldRetryAfter,
					err: serializeError(err),
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
